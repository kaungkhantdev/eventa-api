import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { pickDefined } from '../../common/util/pick-defined';
import type { EventActor } from '../events/events.types';
import { EventsService } from '../events/events.service';
import { SessionResponseDto } from './dto/session-response.dto';
import { toSessionResponse } from './sessions.mapper';
import { SessionsRepository } from './sessions.repository';
import type {
  CreateSessionInput,
  NewSessionValues,
  SessionRow,
  UpdateSessionInput,
} from './sessions.types';

/** A not-yet-inserted session excludes nothing when conflicts are checked. */
const NO_SESSION_YET = '';

/** The only part of a session the overlap test needs. */
interface TimeSpan {
  startTime: string;
  endTime: string | null;
}

/** `09:30:00` → `09:30` — a time an organizer reads, not a database value. */
function short(time: string | null): string {
  return time ? time.slice(0, 5) : '';
}

/** Columns a PATCH may set on a session (speaker links are handled separately). */
const UPDATABLE_KEYS: (keyof NewSessionValues & keyof UpdateSessionInput)[] = [
  'day',
  'startTime',
  'endTime',
  'title',
  'type',
  'room',
  'color',
  'sortOrder',
];

/** Manage an event's agenda sessions and their speaker links (Program context). */
@Injectable()
export class SessionsService {
  constructor(
    private readonly repo: SessionsRepository,
    private readonly events: EventsService,
  ) {}

  async createSession(
    actor: EventActor,
    eventId: string,
    input: CreateSessionInput,
  ): Promise<SessionResponseDto> {
    await this.events.getEvent(actor, eventId); // 404 if not in the caller's org
    const title = this.requireTitle(input.title);
    this.assertTimes(input.startTime, input.endTime ?? null);
    const speakerIds = await this.resolveSpeakers(
      actor.organizationId,
      eventId,
      input.speakerIds,
    );
    const values: NewSessionValues = {
      organizationId: actor.organizationId,
      eventId,
      day: input.day,
      startTime: input.startTime,
      endTime: input.endTime ?? null,
      title,
      type: input.type,
      room: input.room ?? null,
      color: input.color ?? null,
      sortOrder: input.sortOrder ?? 0,
    };
    const warning = await this.assertFeasible(
      actor.organizationId,
      eventId,
      { ...values, id: NO_SESSION_YET } as SessionRow,
      speakerIds,
      input.confirmSpeakerClash ?? false,
    );
    const session = await this.repo.createWithSpeakers(values, speakerIds);
    return this.respond(actor.organizationId, eventId, session, warning);
  }

  async listSessions(
    actor: EventActor,
    eventId: string,
  ): Promise<SessionResponseDto[]> {
    await this.events.getEvent(actor, eventId);
    const rows = await this.repo.listByEvent(actor.organizationId, eventId);
    const refs = await this.repo.speakersFor(
      actor.organizationId,
      rows.map((r) => r.id),
    );
    return rows.map((r) => toSessionResponse(r, refs.get(r.id) ?? [], null));
  }

  async updateSession(
    actor: EventActor,
    eventId: string,
    sessionId: string,
    input: UpdateSessionInput,
  ): Promise<SessionResponseDto> {
    const session = await this.load(actor.organizationId, eventId, sessionId);
    if (input.version !== undefined && input.version !== session.version) {
      throw this.stale();
    }
    if (input.title !== undefined) this.requireTitle(input.title);
    const startTime = input.startTime ?? session.startTime;
    const endTime =
      input.endTime !== undefined ? input.endTime : session.endTime;
    this.assertTimes(startTime, endTime);
    const speakerIds = await this.resolveSpeakers(
      actor.organizationId,
      eventId,
      input.speakerIds,
    );
    const values = this.buildValues(input);
    const warning = await this.assertFeasible(
      actor.organizationId,
      eventId,
      { ...session, ...values, startTime, endTime },
      speakerIds ??
        (await this.repo.currentSpeakerIds(actor.organizationId, sessionId)),
      input.confirmSpeakerClash ?? false,
    );
    const updated = await this.repo.updateWithSpeakers(
      actor.organizationId,
      sessionId,
      values,
      session.version,
      speakerIds,
    );
    if (!updated) throw this.stale();
    return this.respond(actor.organizationId, eventId, updated, warning);
  }

  async deleteSession(
    actor: EventActor,
    eventId: string,
    sessionId: string,
  ): Promise<void> {
    await this.load(actor.organizationId, eventId, sessionId);
    await this.repo.softDelete(actor.organizationId, sessionId);
  }

  /** Build the create/update response: speaker links + any accepted-clash note. */
  private async respond(
    organizationId: number,
    eventId: string,
    session: SessionRow,
    warning: string | null,
  ): Promise<SessionResponseDto> {
    const refs = await this.repo.speakersFor(organizationId, [session.id]);
    return toSessionResponse(session, refs.get(session.id) ?? [], warning);
  }

  /**
   * The two feasibility checks of US-PROG-05, run BEFORE the write so a refusal
   * leaves nothing behind. They differ deliberately:
   *
   * - **A room is physics.** Two sessions cannot occupy one room at one time,
   *   so a clash is refused outright and the message names the room and the
   *   time so the organizer can go straight to it.
   * - **A speaker is a judgement call.** An organizer may genuinely intend a
   *   fly-by appearance across two tracks, so an overlap is refused ONCE with
   *   an explanation and allowed on a re-submit carrying `confirmSpeakerClash`.
   *
   * Parallel tracks in different rooms are untouched by either check, and a
   * session is never compared against itself — `excludeId` sees to that.
   */
  private async assertFeasible(
    organizationId: number,
    eventId: string,
    candidate: SessionRow,
    speakerIds: string[] | undefined,
    confirmed: boolean,
  ): Promise<string | null> {
    await this.assertRoomFree(organizationId, eventId, candidate);
    return this.checkSpeakers(
      organizationId,
      eventId,
      candidate,
      speakerIds,
      confirmed,
    );
  }

  private async assertRoomFree(
    organizationId: number,
    eventId: string,
    candidate: SessionRow,
  ): Promise<void> {
    if (!candidate.room || !candidate.endTime) return;
    const others = await this.repo.sameRoomSessions(
      organizationId,
      eventId,
      candidate.day,
      candidate.room,
      candidate.id,
    );
    const clash = others.find((o) => this.overlaps(candidate, o));
    if (!clash) return;
    throw DomainException.conflict(
      `${candidate.room} is already booked for "${clash.title}" from ${short(clash.startTime)} to ${short(clash.endTime)}. Choose another room or time.`,
    );
  }

  /** Returns the note to echo back once the organizer has confirmed. */
  private async checkSpeakers(
    organizationId: number,
    eventId: string,
    candidate: SessionRow,
    speakerIds: string[] | undefined,
    confirmed: boolean,
  ): Promise<string | null> {
    if (!speakerIds?.length || !candidate.endTime) return null;
    const booked = await this.repo.speakerSessions(
      organizationId,
      eventId,
      candidate.day,
      speakerIds,
      candidate.id,
    );
    const clashes = booked.filter((b) => this.overlaps(candidate, b));
    if (clashes.length === 0) return null;
    const who = [...new Set(clashes.map((c) => c.speakerName))].join(', ');
    const what = clashes.map((c) => `"${c.title}"`).join(', ');
    const note = `${who} is already speaking in ${what} at this time.`;
    if (!confirmed) {
      throw DomainException.conflict(`${note} Confirm to assign them anyway.`);
    }
    return note;
  }

  /** Half-open comparison, so a session ending at 10:00 and one starting at
   * 10:00 are back-to-back rather than clashing. Takes only the times, so it
   * serves both room rows and speaker-clash candidates. */
  private overlaps(a: TimeSpan, b: TimeSpan): boolean {
    if (!a.endTime || !b.endTime) return false;
    const aStart = toSeconds(a.startTime);
    const aEnd = toSeconds(a.endTime);
    const bStart = toSeconds(b.startTime);
    const bEnd = toSeconds(b.endTime);
    return aStart < bEnd && bStart < aEnd;
  }

  /**
   * Undefined `ids` → leave links untouched. Otherwise dedupe, verify every id is
   * a live speaker of the event (422 if not), and return the order to link.
   */
  private async resolveSpeakers(
    organizationId: number,
    eventId: string,
    ids: string[] | undefined,
  ): Promise<string[] | undefined> {
    if (ids === undefined) return undefined;
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    const valid = new Set(
      await this.repo.validSpeakerIds(organizationId, eventId, unique),
    );
    const missing = unique.filter((id) => !valid.has(id));
    if (missing.length > 0) {
      throw DomainException.validation(
        `These speakers are not on this event: ${missing.join(', ')}.`,
      );
    }
    return unique;
  }

  /** Copy the source event's agenda onto a new event, re-linking speakers by map. */
  async cloneForEvent(
    actor: EventActor,
    srcEventId: string,
    destEventId: string,
    speakerIdMap: Map<string, string>,
  ): Promise<void> {
    const rows = await this.repo.listByEvent(actor.organizationId, srcEventId);
    const refs = await this.repo.speakersFor(
      actor.organizationId,
      rows.map((r) => r.id),
    );
    for (const s of rows) {
      const speakerIds = (refs.get(s.id) ?? [])
        .map((r) => speakerIdMap.get(r.id))
        .filter((id): id is string => id !== undefined);
      const values: NewSessionValues = {
        organizationId: actor.organizationId,
        eventId: destEventId,
        day: s.day,
        startTime: s.startTime,
        endTime: s.endTime,
        title: s.title,
        type: s.type,
        room: s.room,
        color: s.color,
        sortOrder: s.sortOrder,
      };
      await this.repo.createWithSpeakers(values, speakerIds);
    }
  }

  private requireTitle(title: string): string {
    const trimmed = title.trim();
    if (!trimmed) throw DomainException.validation('A session needs a title.');
    return trimmed;
  }

  private assertTimes(startTime: string, endTime: string | null): void {
    if (endTime && toSeconds(endTime) <= toSeconds(startTime)) {
      throw DomainException.validation(
        'A session end time must be after its start time.',
      );
    }
  }

  private buildValues(input: UpdateSessionInput): Partial<NewSessionValues> {
    const values = pickDefined(input, UPDATABLE_KEYS);
    if (values.title !== undefined) values.title = values.title.trim();
    return values;
  }

  private async load(
    organizationId: number,
    eventId: string,
    sessionId: string,
  ): Promise<SessionRow> {
    const session = await this.repo.findSession(
      organizationId,
      eventId,
      sessionId,
    );
    if (!session) {
      throw DomainException.notFound(
        `Session ${sessionId} not found for this event.`,
      );
    }
    return session;
  }

  private stale(): DomainException {
    return DomainException.conflict(
      'This session changed elsewhere. Reload and try again.',
    );
  }
}

/**
 * Parse `HH:MM` or `HH:MM:SS` into seconds since midnight. Keeping seconds keeps
 * the interval check consistent with the DTO's HH:MM:SS regex and the DB's
 * `ck_sessions_time` (end_time > start_time) CHECK — a sub-minute session isn't
 * falsely rejected, and sub-minute overlaps are still detected.
 */
function toSeconds(time: string): number {
  const [hours, minutes, seconds] = time.split(':');
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds ?? 0);
}
