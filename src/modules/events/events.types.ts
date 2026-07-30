import type { events } from '../../db/schema';

/** A selected `events` row. */
export type EventRow = typeof events.$inferSelect;
/** An `events` insert shape. */
export type NewEventValues = typeof events.$inferInsert;

export type EventType = EventRow['type'];
export type EventStatus = EventRow['status'];
export type EventBucket = EventRow['bucket'];
/** `recent` = newest first (default); `name` A–Z; `date` by start time. */
export type EventSort = 'recent' | 'name' | 'date';

/** Query for the organizer's event list (mapped from the query DTO). */
export interface ListEventsQuery {
  page?: number;
  limit?: number;
  q?: string;
  type?: EventType;
  bucket?: EventBucket;
  sort?: EventSort;
}

/** Normalized list options handed to the repository. */
export interface ListEventsOptions {
  limit: number;
  offset: number;
  sort: EventSort;
  q?: string;
  type?: EventType;
  bucket?: EventBucket;
}

/** The authenticated principal slice the events service needs. */
export interface EventActor {
  organizationId: number;
  userId: string;
}

/** Service-level input for creating a draft event (mapped from the DTO). */
export interface CreateEventInput {
  name: string;
  type: EventType;
  startAt: Date;
  description?: string;
  categoryId?: number;
  organizerName?: string;
}

export type SeatingMode = EventRow['seatingMode'];
export type Visibility = EventRow['visibility'];
/** A landing-template id (non-null — a published event may pick one). */
export type TemplateId = NonNullable<EventRow['landingTemplateId']>;

/** Service input to publish an event (mapped from the DTO). */
export interface PublishEventInput {
  visibility?: Visibility;
  landingTemplateId?: TemplateId;
  /** Publish despite a start date already in the past. */
  confirmPastStart?: boolean;
  /** Optimistic-concurrency token; when set, must match the current row. */
  version?: number;
}

/** Service input to unpublish an event. */
export interface UnpublishEventInput {
  version?: number;
}

/** Service input to delete an event. */
export interface DeleteEventInput {
  version?: number;
}

/** Service input to cancel an event (reason required). */
export interface CancelEventInput {
  reason: string;
  version?: number;
}

/** Partial update to an event (Basics + Date/Location). Undefined = leave as-is. */
export interface UpdateEventInput {
  name?: string;
  description?: string | null;
  type?: EventType;
  categoryId?: number | null;
  startAt?: Date;
  endAt?: Date | null;
  timezone?: string;
  venueName?: string | null;
  venueAddress?: string | null;
  city?: string | null;
  isOnline?: boolean;
  onlineNote?: string | null;
  seatingMode?: SeatingMode;
  capacity?: number | null;
  coverImage?: string | null;
  accentColor?: string | null;
  contactEmail?: string | null;
  /** Optimistic-concurrency token from the client (must match the current row). */
  version?: number;
}
