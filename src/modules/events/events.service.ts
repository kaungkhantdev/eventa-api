import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { Clock } from '../../common/time/clock';
import { DomainException } from '../../common/errors/domain.exception';
import { pickDefined } from '../../common/util/pick-defined';
import { OutboxPort } from '../platform/outbox.port';
import { EventResponseDto } from './dto/event-response.dto';
import { eventCancelledEvent } from './events/event-cancelled.event';
import { eventPublishedEvent } from './events/event-published.event';
import { toEventResponse } from './events.mapper';
import { EventsRepository } from './events.repository';
import { sanitizeDescription } from './rich-text';
import { TicketAvailabilityPort } from './ports/ticket-availability.port';
import type {
  CancelEventInput,
  CreateEventInput,
  DeleteEventInput,
  EventActor,
  EventBucket,
  EventRow,
  EventStatus,
  PublishEventInput,
  NewEventValues,
  UnpublishEventInput,
  UpdateEventInput,
  Visibility,
} from './events.types';
import { slugify } from '../../common/util/slugify';

/** Slug used when a name carries no latin alphanumerics (e.g. a Thai-only name). */
const EVENT_SLUG_FALLBACK = 'event';

const DRAFT_STATUS: EventStatus = 'draft';
const PUBLISHED_STATUS: EventStatus = 'upcoming';
const CANCELLED_STATUS: EventStatus = 'cancelled';
const COMPLETED_STATUS: EventStatus = 'completed';
const PRIVATE_VISIBILITY: Visibility = 'private';

/** Human phrase per publish requirement, listed back when one is missing. */
const PUBLISH_REQUIREMENTS = {
  title: 'a title',
  description: 'a description',
  schedule: 'a start date & time',
  location: 'a venue or an online link',
  tickets: 'at least one ticket type',
} as const;
type PublishRequirement = keyof typeof PUBLISH_REQUIREMENTS;

/**
 * The description is rich text an ORGANIZER authors and an ATTENDEE loads on a
 * public page, so it is sanitised on the way IN — both write paths below go
 * through these. Cleaning on read instead would put the obligation on every
 * consumer, and the first one to forget serves the payload.
 */
function cleanDescription(html: string | undefined): string | null {
  if (html === undefined) return null;
  return sanitizeDescription(html) || null;
}

/**
 * The same, for a PATCH. Absent means "leave it alone" and null means "clear
 * it" — neither is a value to clean, and both must survive untouched.
 */
function withCleanDescription(input: UpdateEventInput): UpdateEventInput {
  const { description } = input;
  if (description === undefined || description === null) return input;
  return { ...input, description: sanitizeDescription(description) };
}

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
  // Settable after publishing, not only during it: changing how the public
  // page looks should not mean taking it down and putting it back up.
  'landingTemplateId',
];

/** event_bucket is derived from lifecycle status (entities.md): terminal → completed. */
function bucketForStatus(status: EventStatus): EventBucket {
  return status === 'completed' || status === 'cancelled'
    ? 'completed'
    : 'active';
}

/** Orchestrates event management rules (the Events bounded context). */
@Injectable()
export class EventsService {
  constructor(
    private readonly repo: EventsRepository,
    @Inject(forwardRef(() => TicketAvailabilityPort))
    private readonly tickets: TicketAvailabilityPort,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

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
      description: cleanDescription(input.description),
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

  /**
   * Copy an event's details into a fresh "… (Copy)" draft (US-EVT-13). Everything
   * lifecycle/sales-related resets: a new slug, status=draft, no published/cancelled
   * stamps. Ticket/agenda/seating copies are layered on by the caller.
   */
  async duplicateBasics(
    actor: EventActor,
    srcEventId: string,
  ): Promise<EventResponseDto> {
    const src = await this.loadEvent(actor.organizationId, srcEventId);
    const name = `${src.name} (Copy)`;
    const values: NewEventValues = {
      organizationId: actor.organizationId,
      slug: await this.uniqueSlug(actor.organizationId, name),
      name,
      type: src.type,
      status: DRAFT_STATUS,
      bucket: bucketForStatus(DRAFT_STATUS),
      visibility: src.visibility,
      categoryId: src.categoryId,
      startAt: src.startAt,
      endAt: src.endAt,
      timezone: src.timezone,
      venueName: src.venueName,
      venueAddress: src.venueAddress,
      city: src.city,
      isOnline: src.isOnline,
      onlineNote: src.onlineNote,
      seatingMode: src.seatingMode,
      capacity: src.capacity,
      coverImage: src.coverImage,
      accentColor: src.accentColor,
      organizerName: src.organizerName,
      contactEmail: src.contactEmail,
      landingTemplateId: src.landingTemplateId,
      description: src.description,
      createdBy: actor.userId,
    };
    return toEventResponse(await this.repo.insert(values));
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
      pickDefined(withCleanDescription(input), UPDATABLE_KEYS),
      event.version,
    );
    if (!updated) throw this.staleEvent();
    return toEventResponse(updated);
  }

  /** Take a draft live: enforce the readiness gate, then publish + notify. */
  async publishEvent(
    actor: EventActor,
    eventId: string,
    input: PublishEventInput,
  ): Promise<EventResponseDto> {
    const event = await this.loadEvent(actor.organizationId, eventId);
    if (event.status !== DRAFT_STATUS) {
      throw DomainException.conflict('This event is already published.');
    }
    if (input.version !== undefined && input.version !== event.version) {
      throw this.staleEvent();
    }
    const gaps = await this.readinessGaps(actor.organizationId, event);
    if (gaps.length > 0) throw this.notReady(gaps);
    if (this.startsInPast(event.startAt) && !input.confirmPastStart) {
      throw DomainException.validation(
        "This event's start date is already in the past. Confirm to publish it anyway.",
      );
    }
    const published = await this.repo.update(
      actor.organizationId,
      eventId,
      this.publishValues(input),
      event.version,
    );
    if (!published) throw this.staleEvent();
    await this.announcePublished(actor, published);
    return toEventResponse(published);
  }

  /** Take a published event offline: back to a private draft, content preserved. */
  async unpublishEvent(
    actor: EventActor,
    eventId: string,
    input: UnpublishEventInput,
  ): Promise<EventResponseDto> {
    const event = await this.loadEvent(actor.organizationId, eventId);
    if (event.status === DRAFT_STATUS) {
      throw DomainException.conflict('This event is not published.');
    }
    if (input.version !== undefined && input.version !== event.version) {
      throw this.staleEvent();
    }
    const values: Partial<NewEventValues> = {
      status: DRAFT_STATUS,
      bucket: bucketForStatus(DRAFT_STATUS),
      visibility: PRIVATE_VISIBILITY,
      publishedAt: null,
    };
    const updated = await this.repo.update(
      actor.organizationId,
      eventId,
      values,
      event.version,
    );
    if (!updated) throw this.staleEvent();
    return toEventResponse(updated);
  }

  /**
   * Permanently delete an event — only a draft with no registrations. A published
   * event, or one with sales, is never hard-deleted (409, routed to Cancel).
   */
  async deleteEvent(
    actor: EventActor,
    eventId: string,
    input: DeleteEventInput,
  ): Promise<void> {
    const event = await this.loadEvent(actor.organizationId, eventId);
    if (input.version !== undefined && input.version !== event.version) {
      throw this.staleEvent();
    }
    if (event.status !== DRAFT_STATUS) {
      throw DomainException.conflict(
        'A published event cannot be deleted. Cancel it instead to refund and notify attendees.',
      );
    }
    const sold = await this.tickets.soldCount(actor.organizationId, eventId);
    if (sold > 0) {
      throw DomainException.conflict(
        "This event has registrations and can't be deleted. Cancel it instead to refund and notify attendees.",
      );
    }
    await this.repo.hardDelete(actor.organizationId, eventId);
  }

  /**
   * Cancel an event: it stops accepting registrations and moves out of the Active
   * bucket (retained for reporting). The refund/waitlist/notify side effects are
   * emitted to the outbox for the worker; the request itself always succeeds.
   */
  async cancelEvent(
    actor: EventActor,
    eventId: string,
    input: CancelEventInput,
  ): Promise<EventResponseDto> {
    const event = await this.loadEvent(actor.organizationId, eventId);
    if (input.version !== undefined && input.version !== event.version) {
      throw this.staleEvent();
    }
    const reason = input.reason.trim();
    if (!reason) {
      throw DomainException.validation('A cancellation reason is required.');
    }
    if (
      event.status === CANCELLED_STATUS ||
      event.status === COMPLETED_STATUS
    ) {
      throw DomainException.conflict('This event can no longer be cancelled.');
    }
    const cancelled = await this.repo.update(
      actor.organizationId,
      eventId,
      {
        status: CANCELLED_STATUS,
        bucket: bucketForStatus(CANCELLED_STATUS),
        cancelledAt: this.clock.now(),
      },
      event.version,
    );
    if (!cancelled) throw this.staleEvent();
    await this.announceCancelled(actor, cancelled, reason);
    return toEventResponse(cancelled);
  }

  private async announceCancelled(
    actor: EventActor,
    event: EventRow,
    reason: string,
  ): Promise<void> {
    await this.outbox.enqueue(
      eventCancelledEvent({
        organizationId: actor.organizationId,
        eventId: event.id,
        slug: event.slug,
        name: event.name,
        reason,
        cancelledBy: actor.userId,
        occurredAt: this.clock.now().toISOString(),
      }),
    );
  }

  private publishValues(input: PublishEventInput): Partial<NewEventValues> {
    return {
      status: PUBLISHED_STATUS,
      bucket: bucketForStatus(PUBLISHED_STATUS),
      publishedAt: this.clock.now(),
      ...(input.visibility ? { visibility: input.visibility } : {}),
      ...(input.landingTemplateId
        ? { landingTemplateId: input.landingTemplateId }
        : {}),
    };
  }

  /** Which required items an event is still missing before it can go public. */
  private async readinessGaps(
    organizationId: number,
    e: EventRow,
  ): Promise<PublishRequirement[]> {
    const gaps: PublishRequirement[] = [];
    if (!e.name.trim()) gaps.push('title');
    if (!e.description?.trim()) gaps.push('description');
    if (!e.venueName?.trim() && !e.isOnline) gaps.push('location');
    if ((await this.tickets.activeCount(organizationId, e.id)) < 1) {
      gaps.push('tickets');
    }
    return gaps;
  }

  private notReady(gaps: PublishRequirement[]): DomainException {
    const items = gaps.map((g) => PUBLISH_REQUIREMENTS[g]).join(', ');
    return DomainException.validation(
      `Cannot publish yet — please add ${items}.`,
      gaps,
    );
  }

  private startsInPast(startAt: Date): boolean {
    return startAt.getTime() < this.clock.now().getTime();
  }

  private async announcePublished(
    actor: EventActor,
    event: EventRow,
  ): Promise<void> {
    await this.outbox.enqueue(
      eventPublishedEvent({
        organizationId: actor.organizationId,
        eventId: event.id,
        slug: event.slug,
        name: event.name,
        publishedBy: actor.userId,
        occurredAt: this.clock.now().toISOString(),
      }),
    );
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

  /** First slug of `slugify(name)`, `-2`, `-3`… not already taken in this org. */
  private async uniqueSlug(
    organizationId: number,
    name: string,
  ): Promise<string> {
    const base = slugify(name, EVENT_SLUG_FALLBACK);
    const taken = new Set(await this.repo.existingSlugs(organizationId, base));
    if (!taken.has(base)) return base;
    for (let i = 2; ; i += 1) {
      const candidate = `${base}-${i}`;
      if (!taken.has(candidate)) return candidate;
    }
  }
}
