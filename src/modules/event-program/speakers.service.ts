import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { pickDefined } from '../../common/util/pick-defined';
import type { EventActor } from '../events/events.types';
import { EventsService } from '../events/events.service';
import { SpeakerResponseDto } from './dto/speaker-response.dto';
import { toSpeakerResponse } from './speakers.mapper';
import { SpeakersRepository } from './speakers.repository';
import type {
  CreateSpeakerInput,
  NewSpeakerValues,
  SpeakerRow,
  UpdateSpeakerInput,
} from './speakers.types';

/** Fields a PATCH may set on a speaker. */
const UPDATABLE_KEYS: (keyof NewSpeakerValues & keyof UpdateSpeakerInput)[] = [
  'name',
  'role',
  'email',
  'phone',
  'talkTitle',
  'tag',
  'initials',
  'tone',
];

/** Manage an event's speaker line-up (Events & Program context). */
@Injectable()
export class SpeakersService {
  constructor(
    private readonly repo: SpeakersRepository,
    private readonly events: EventsService,
  ) {}

  async createSpeaker(
    actor: EventActor,
    eventId: string,
    input: CreateSpeakerInput,
  ): Promise<SpeakerResponseDto> {
    await this.events.getEvent(actor, eventId); // 404 if not in the caller's org
    const name = this.requireName(input.name);
    const values: NewSpeakerValues = {
      organizationId: actor.organizationId,
      eventId,
      name,
      role: input.role ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      talkTitle: input.talkTitle ?? null,
      tag: input.tag ?? null,
      initials: input.initials ?? null,
      tone: input.tone ?? null,
    };
    return toSpeakerResponse(await this.repo.insert(values));
  }

  async listSpeakers(
    actor: EventActor,
    eventId: string,
  ): Promise<SpeakerResponseDto[]> {
    await this.events.getEvent(actor, eventId);
    const rows = await this.repo.listByEvent(actor.organizationId, eventId);
    if (rows.length === 0) return [];
    // One grouped query for the whole page rather than a count per speaker.
    const counts = await this.repo.sessionCounts(
      actor.organizationId,
      rows.map((r) => r.id),
    );
    return rows.map((r) => toSpeakerResponse(r, counts.get(r.id) ?? 0));
  }

  async updateSpeaker(
    actor: EventActor,
    eventId: string,
    speakerId: string,
    input: UpdateSpeakerInput,
  ): Promise<SpeakerResponseDto> {
    const speaker = await this.load(actor.organizationId, eventId, speakerId);
    if (input.version !== undefined && input.version !== speaker.version) {
      throw this.stale();
    }
    if (input.name !== undefined) this.requireName(input.name);
    const updated = await this.repo.update(
      actor.organizationId,
      speakerId,
      this.buildValues(input),
      speaker.version,
    );
    if (!updated) throw this.stale();
    return toSpeakerResponse(updated);
  }

  async deleteSpeaker(
    actor: EventActor,
    eventId: string,
    speakerId: string,
  ): Promise<void> {
    await this.load(actor.organizationId, eventId, speakerId);
    await this.repo.softDelete(actor.organizationId, speakerId);
  }

  /** Copy the source event's speakers onto a new event; returns old→new id map. */
  async cloneForEvent(
    actor: EventActor,
    srcEventId: string,
    destEventId: string,
  ): Promise<Map<string, string>> {
    const rows = await this.repo.listByEvent(actor.organizationId, srcEventId);
    const idMap = new Map<string, string>();
    for (const s of rows) {
      const values: NewSpeakerValues = {
        organizationId: actor.organizationId,
        eventId: destEventId,
        name: s.name,
        role: s.role,
        email: s.email,
        phone: s.phone,
        talkTitle: s.talkTitle,
        tag: s.tag,
        initials: s.initials,
        tone: s.tone,
      };
      const copy = await this.repo.insert(values);
      idMap.set(s.id, copy.id);
    }
    return idMap;
  }

  private requireName(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) throw DomainException.validation('A speaker needs a name.');
    return trimmed;
  }

  private buildValues(input: UpdateSpeakerInput): Partial<NewSpeakerValues> {
    const values = pickDefined(input, UPDATABLE_KEYS);
    if (values.name !== undefined) values.name = values.name.trim();
    return values;
  }

  private async load(
    organizationId: number,
    eventId: string,
    speakerId: string,
  ): Promise<SpeakerRow> {
    const speaker = await this.repo.findSpeaker(
      organizationId,
      eventId,
      speakerId,
    );
    if (!speaker) {
      throw DomainException.notFound(
        `Speaker ${speakerId} not found for this event.`,
      );
    }
    return speaker;
  }

  private stale(): DomainException {
    return DomainException.conflict(
      'This speaker changed elsewhere. Reload and try again.',
    );
  }
}
