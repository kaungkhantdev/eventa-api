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
    landingTemplateId: templateIdEnum().references(() => landingTemplates.id, {
      onDelete: 'set null',
    }),
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
