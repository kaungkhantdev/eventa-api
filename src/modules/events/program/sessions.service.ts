import { Injectable } from '@nestjs/common';
import { DomainException } from '../../../common/errors/domain.exception';
import { pickDefined } from '../../../common/util/pick-defined';
import type { EventActor } from '../events.types';
import { EventsService } from '../events.service';
import { SessionResponseDto } from './dto/session-response.dto';
import { toSessionResponse } from './sessions.mapper';
import { SessionsRepository } from './sessions.repository';
import type {
  CreateSessionInput,
  NewSessionValues,
  SessionRow,
  UpdateSessionInput,
} from './sessions.types';

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
    const session = await this.repo.createWithSpeakers(values, speakerIds);
    return this.respond(actor.organizationId, eventId, session);
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
    const updated = await this.repo.updateWithSpeakers(
      actor.organizationId,
      sessionId,
      this.buildValues(input),
      session.version,
      speakerIds,
    );
    if (!updated) throw this.stale();
    return this.respond(actor.organizationId, eventId, updated);
  }

  async deleteSession(
    actor: EventActor,
    eventId: string,
    sessionId: string,
  ): Promise<void> {
    await this.load(actor.organizationId, eventId, sessionId);
    await this.repo.softDelete(actor.organizationId, sessionId);
  }

  /** Build the create/update response: speaker links + a non-blocking overlap note. */
  private async respond(
    organizationId: number,
    eventId: string,
    session: SessionRow,
  ): Promise<SessionResponseDto> {
    const warning = await this.overlapWarning(organizationId, eventId, session);
    const refs = await this.repo.speakersFor(organizationId, [session.id]);
    return toSessionResponse(session, refs.get(session.id) ?? [], warning);
  }

  /** Warn (never block) when a same-room, same-day session overlaps in time. */
  private async overlapWarning(
    organizationId: number,
    eventId: string,
    session: SessionRow,
  ): Promise<string | null> {
    if (!session.room || !session.endTime) return null;
    const others = await this.repo.sameRoomSessions(
      organizationId,
      eventId,
      session.day,
      session.room,
      session.id,
    );
    const clashes = others.filter((o) => this.overlaps(session, o));
    if (clashes.length === 0) return null;
    const titles = clashes.map((c) => `"${c.title}"`).join(', ');
    return `Overlaps ${titles} in ${session.room}. Multi-track rooms are fine, so this is allowed.`;
  }

  private overlaps(a: SessionRow, b: SessionRow): boolean {
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
