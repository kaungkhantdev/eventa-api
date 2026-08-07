import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { pickDefined } from '../../common/util/pick-defined';
import type { EventActor } from '../events/events.types';
import { EventsService } from '../events/events.service';
import { Paginated } from '../../common/http/paginated';
import { SpeakerResponseDto } from './dto/speaker-response.dto';
import { toSpeakerResponse } from './speakers.mapper';
import { SpeakersRepository } from './speakers.repository';
import type {
  CreateSpeakerInput,
  SpeakerFilters,
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
  'bio',
  'photoUrl',
  'website',
  'socialLinks',
];

export const DEFAULT_LIMIT = 24;
export const MAX_LIMIT = 100;

const DUPLICATE_EMAIL =
  'Another speaker on this event already uses that email address.';

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
      bio: input.bio ?? null,
      photoUrl: input.photoUrl ?? null,
      website: input.website ?? null,
      socialLinks: input.socialLinks ?? null,
    };
    await this.assertEmailFree(actor.organizationId, eventId, input.email);
    // A brand-new speaker is in nothing yet, so the count is 0 by definition.
    return toSpeakerResponse(await this.repo.insert(values), 0);
  }

  /**
   * The speaker directory (US-PROG-08): searchable by name, role or email, and
   * paginated so `meta.total` is the FILTERED total the console shows beside
   * the list. An empty result is a page with no items, never an error.
   */
  async listSpeakers(
    actor: EventActor,
    eventId: string,
    query: Partial<SpeakerFilters> = {},
  ): Promise<Paginated<SpeakerResponseDto>> {
    await this.events.getEvent(actor, eventId);
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, query.limit ?? DEFAULT_LIMIT),
    );
    const { items, total } = await this.repo.page(
      actor.organizationId,
      eventId,
      {
        ...query,
        page,
        limit,
      },
    );
    if (items.length === 0) return Paginated.of([], total, page, limit);
    // One grouped query for the whole page rather than a count per speaker.
    const counts = await this.repo.sessionCounts(
      actor.organizationId,
      items.map((r) => r.id),
    );
    return Paginated.of(
      items.map((r) => toSpeakerResponse(r, counts.get(r.id) ?? 0)),
      total,
      page,
      limit,
    );
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
    if (input.email) {
      await this.assertEmailFree(
        actor.organizationId,
        eventId,
        input.email,
        speakerId,
      );
    }
    const updated = await this.repo.update(
      actor.organizationId,
      speakerId,
      this.buildValues(input),
      speaker.version,
    );
    if (!updated) throw this.stale();
    const counts = await this.repo.sessionCounts(actor.organizationId, [
      speakerId,
    ]);
    return toSpeakerResponse(updated, counts.get(speakerId) ?? 0);
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

  /**
   * One live speaker per email per event (US-PROG-09/10). Checked here for a
   * clean 409 and enforced by `uq_speakers_event_email` underneath, so a race
   * cannot slip a duplicate past the read.
   */
  private async assertEmailFree(
    organizationId: number,
    eventId: string,
    email: string | null | undefined,
    excludeId?: string,
  ): Promise<void> {
    if (!email) return;
    const existing = await this.repo.findByEmail(
      organizationId,
      eventId,
      email,
      excludeId,
    );
    if (existing) throw DomainException.conflict(DUPLICATE_EMAIL);
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
