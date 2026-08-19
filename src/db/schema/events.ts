import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, idPk, updatedAt, version } from './_columns';
import {
  categoryColorEnum,
  eventBucketEnum,
  eventStatusEnum,
  eventTypeEnum,
  localeEnum,
  seatingModeEnum,
  templateIdEnum,
  visibilityEnum,
} from './enums';
import { citext } from './_types';
import { organizations } from './organizations';
import { users } from './identity';

/** Event categorization for discover/landing. Org-scoped, seeded then customizable. */
export const categories = pgTable(
  'categories',
  {
    id: idPk(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    description: text(),
    icon: text().notNull(),
    color: categoryColorEnum().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
    version: version(),
  },
  (t) => [
    unique('uq_categories_org_name').on(t.organizationId, t.name),
    index('ix_categories_org').on(t.organizationId),
  ],
);

/** Global seed lookup of public landing-page templates. Not tenant-scoped. */
export const landingTemplates = pgTable('landing_templates', {
  id: templateIdEnum().primaryKey(),
  title: text().notNull(),
  badge: text().notNull(),
  description: text().notNull(),
});

/** Central aggregate: an event owned by an organization. */
export const events = pgTable(
  'events',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    slug: text().notNull(),
    name: text().notNull(),
    description: text(),
    type: eventTypeEnum().notNull(),
    status: eventStatusEnum().notNull().default('draft'),
    /**
     * When true a sign-up lands `pending` and waits for an organizer's decision
     * (US-REG-02); when false checkout confirms it outright.
     */
    requiresApproval: boolean().notNull().default(false),
    bucket: eventBucketEnum().notNull(),
    visibility: visibilityEnum().notNull().default('private'),
    categoryId: bigint({ mode: 'number' }).references(() => categories.id, {
      onDelete: 'set null',
    }),
    startAt: timestamp({ withTimezone: true }).notNull(),
    endAt: timestamp({ withTimezone: true }),
    timezone: text().notNull().default('Asia/Bangkok'),
    venueName: text(),
    venueAddress: text(),
    city: text(),
    isOnline: boolean().notNull().default(false),
    onlineNote: text(),
    seatingMode: seatingModeEnum().notNull().default('ga'),
    capacity: integer(),
    coverImage: text(),
    accentColor: text(),
    organizerName: text().notNull(),
    contactEmail: citext(),
    /** Custom heading for the agenda section; falls back to a default (US-PAGE-04). */
    agendaTitle: text(),
    /** Custom heading for the speakers section (US-PAGE-04). */
    speakersTitle: text(),
    landingTemplateId: templateIdEnum().references(() => landingTemplates.id, {
      onDelete: 'set null',
    }),
    /**
     * The language this event's automated messages default to when the
     * recipient has no preference of their own (US-MSG-01); null falls back to
     * the workspace's `organizations.locale`.
     */
    locale: localeEnum(),
    publishedAt: timestamp({ withTimezone: true }),
    cancelledAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    version: version(),
  },
  (t) => [
    unique('uq_events_org_slug').on(t.organizationId, t.slug),
    index('ix_events_org_status').on(t.organizationId, t.status),
    index('ix_events_start_at').on(t.startAt),
    index('ix_events_type').on(t.type),
    index('ix_events_category').on(t.categoryId),
  ],
);

/**
 * A bullet the organizer arranges on the public page (US-PAGE-04). Ordered by
 * `position`; an event with none simply renders no Highlights section.
 */
export const eventHighlights = pgTable(
  'event_highlights',
  {
    id: idPk(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    eventId: uuid()
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    text: text().notNull(),
    /** Optional icon key the template renders beside the bullet. */
    icon: text(),
    position: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('ix_event_highlights_event').on(t.eventId, t.position)],
);

/** A question/answer pair shown on the public page (US-PAGE-06). */
export const eventFaqs = pgTable(
  'event_faqs',
  {
    id: idPk(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    eventId: uuid()
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    question: text().notNull(),
    answer: text().notNull(),
    position: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('ix_event_faqs_event').on(t.eventId, t.position)],
);
