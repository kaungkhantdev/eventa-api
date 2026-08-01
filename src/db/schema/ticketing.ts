import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { boolean } from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, updatedAt, version } from './_columns';
import { admissionTypeEnum, ticketStatusEnum } from './enums';
import { events } from './events';
import { organizations } from './organizations';

/** A sellable ticket tier for an event. Prices are VAT-inclusive integer satang. */
export const ticketTypes = pgTable(
  'ticket_types',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    eventId: uuid()
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    isFree: boolean().notNull().default(false),
    priceSatang: bigint({ mode: 'number' }).notNull().default(0),
    currency: char({ length: 3 }).notNull().default('THB'),
    status: ticketStatusEnum().notNull().default('scheduled'),
    admissionType: admissionTypeEnum().notNull().default('general_admission'),
    sold: integer().notNull().default(0),
    total: integer().notNull().default(0),
    salesStartAt: timestamp({ withTimezone: true }),
    salesEndAt: timestamp({ withTimezone: true }),
    minPerOrder: integer().notNull().default(1),
    maxPerOrder: integer().notNull().default(8),
    iconClass: text(),
    /** "What's included" bullets shown on the public page (US-PAGE-05). */
    includes: jsonb().$type<string[]>(),
    /** The tier the page highlights, with its badge text (US-PAGE-05). */
    isRecommended: boolean().notNull().default(false),
    badge: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
    version: version(),
  },
  (t) => [
    index('ix_ticket_types_event').on(t.eventId),
    index('ix_ticket_types_org').on(t.organizationId),
    check(
      'ck_ticket_types_sold',
      sql`${t.sold} >= 0 AND ${t.sold} <= ${t.total}`,
    ),
    check('ck_ticket_types_price', sql`${t.priceSatang} >= 0`),
    check(
      'ck_ticket_types_free_price',
      sql`NOT ${t.isFree} OR ${t.priceSatang} = 0`,
    ),
  ],
);
