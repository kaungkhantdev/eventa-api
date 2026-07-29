import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { Paginated } from '../../common/http/paginated';
import { EventResponseDto } from './dto/event-response.dto';
import { toEventResponse } from './events.mapper';
import { EventsRepository } from './events.repository';
import type {
  CreateEventInput,
  EventActor,
  EventBucket,
  EventRow,
  EventStatus,
  ListEventsOptions,
  ListEventsQuery,
  NewEventValues,
  UpdateEventInput,
} from './events.types';
import { slugify } from './slug';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** Fields a PATCH may set on an event (Basics + Date/Location). */
const UPDATABLE_KEYS: (keyof NewEventValues & keyof UpdateEventInput)[] = [
  'name',
  'description',
  'type',
  'categoryId',
  'startAt',
  'endAt',
  'timezone',
  'venueName',
  'venueAddress',
  'city',
  'isOnline',
  'onlineNote',
  'seatingMode',
  'capacity',
  'coverImage',
  'accentColor',
  'contactEmail',
];

/** event_bucket is derived from lifecycle status (entities.md): terminal → completed. */
function bucketForStatus(status: EventStatus): EventBucket {
  return status === 'completed' || status === 'cancelled'
    ? 'completed'
    : 'active';
}

/** Copy only the keys present (not undefined) in `source` — PATCH semantics. */
function pickDefined<T, K extends keyof T>(
  source: T,
  keys: readonly K[],
): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

/** Orchestrates event management rules (the Events bounded context). */
@Injectable()
export class EventsService {
  constructor(private readonly repo: EventsRepository) {}

  /** Create an event in Draft; derives a unique per-org slug and defaults. */
  async createDraft(
    actor: EventActor,
    input: CreateEventInput,
  ): Promise<EventResponseDto> {
    if (input.categoryId !== undefined) {
      await this.assertCategoryInOrg(actor.organizationId, input.categoryId);
    }
    const slug = await this.uniqueSlug(actor.organizationId, input.name);
    const organizerName =
      input.organizerName ??
      (await this.repo.organizationName(actor.organizationId));

    const status: EventStatus = 'draft';
    const values: NewEventValues = {
      organizationId: actor.organizationId,
      slug,
      name: input.name,
      type: input.type,
      status,
      bucket: bucketForStatus(status),
      startAt: input.startAt,
      description: input.description ?? null,
      categoryId: input.categoryId ?? null,
      organizerName,
      createdBy: actor.userId,
    };
    return toEventResponse(await this.repo.insert(values));
  }

  /** A category referenced on create must exist in the caller's tenant (else 404). */
  private async assertCategoryInOrg(
    organizationId: number,
    categoryId: number,
  ): Promise<void> {
    if (!(await this.repo.categoryExists(organizationId, categoryId))) {
      throw DomainException.notFound(
        `Category ${categoryId} not found in this workspace.`,
      );
    }
  }

  /** A single event owned by the caller's org (404 otherwise). */
  async getEvent(
    actor: EventActor,
    eventId: string,
  ): Promise<EventResponseDto> {
    return toEventResponse(await this.loadEvent(actor.organizationId, eventId));
  }

  /** Update an event's Basics + Date/Location (optimistic-concurrency guarded). */
  async updateEvent(
    actor: EventActor,
    eventId: string,
    input: UpdateEventInput,
  ): Promise<EventResponseDto> {
    const event = await this.loadEvent(actor.organizationId, eventId);
    if (input.version !== undefined && input.version !== event.version) {
      throw this.staleEvent();
    }
    this.assertEndAfterStart(input, event);
    if (input.categoryId != null) {
      await this.assertCategoryInOrg(actor.organizationId, input.categoryId);
    }
    const updated = await this.repo.update(
      actor.organizationId,
      eventId,
      pickDefined(input, UPDATABLE_KEYS),
      event.version,
    );
    if (!updated) throw this.staleEvent();
    return toEventResponse(updated);
  }

  private async loadEvent(
    organizationId: number,
    eventId: string,
  ): Promise<EventRow> {
    const event = await this.repo.findEvent(organizationId, eventId);
    if (!event) throw DomainException.notFound(`Event ${eventId} not found.`);
    return event;
  }

  private assertEndAfterStart(input: UpdateEventInput, event: EventRow): void {
    const startAt = input.startAt ?? event.startAt;
    const endAt = input.endAt !== undefined ? input.endAt : event.endAt;
    if (endAt && endAt.getTime() <= startAt.getTime()) {
      throw DomainException.validation(
        'End time must be after the start time.',
      );
    }
  }

  private staleEvent(): DomainException {
    return DomainException.conflict(
      'This event changed elsewhere. Reload the latest version and try again.',
    );
  }

  /** The organizer's events for this tenant, filtered/sorted, one page at a time. */
  async list(
    actor: EventActor,
    query: ListEventsQuery,
  ): Promise<Paginated<EventResponseDto>> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, query.limit ?? DEFAULT_LIMIT),
    );
    const options: ListEventsOptions = {
      limit,
      offset: (page - 1) * limit,
      sort: query.sort ?? 'recent',
      ...(query.q ? { q: query.q } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.bucket ? { bucket: query.bucket } : {}),
    };
    const { items, total } = await this.repo.list(
      actor.organizationId,
      options,
    );
    return Paginated.of(items.map(toEventResponse), total, page, limit);
  }

  /** First slug of `slugify(name)`, `-2`, `-3`… not already taken in this org. */
  private async uniqueSlug(
    organizationId: number,
    name: string,
  ): Promise<string> {
    const base = slugify(name);
    const taken = new Set(await this.repo.existingSlugs(organizationId, base));
    if (!taken.has(base)) return base;
    for (let i = 2; ; i += 1) {
      const candidate = `${base}-${i}`;
      if (!taken.has(candidate)) return candidate;
    }
  }
}
