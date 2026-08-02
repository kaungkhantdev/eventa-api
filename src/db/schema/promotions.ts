import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, updatedAt, version } from './_columns';
import { discountStatusEnum, discountTypeEnum } from './enums';
import { events } from './events';
import { organizations } from './organizations';

/**
 * A redeemable discount, scoped to one event or to the whole workspace when
 * `eventId` is null (US-TKT-07). Percent values are 1–100; fixed values are
 * satang, like every other amount in the system.
 *
 * The redemption junction lives in `registration.ts` beside `orders` — it points
 * at both tables, and keeping it here would make the two schema modules import
 * each other.
 */
export const discountCodes = pgTable(
  'discount_codes',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Null = applies to every event in the workspace. */
    eventId: uuid().references(() => events.id, { onDelete: 'cascade' }),
    /** Stored uppercase so matching is case-insensitive without a functional index. */
    code: text().notNull(),
    type: discountTypeEnum().notNull(),
    value: integer().notNull(),
    status: discountStatusEnum().notNull().default('scheduled'),
    /** Redemptions made so far; the counter the limit is checked against. */
    used: integer().notNull().default(0),
    /** 0 = unlimited. */
    redemptionLimit: integer().notNull().default(0),
    /** 0 = unlimited redemptions per buyer. */
    perPersonLimit: integer().notNull().default(0),
    /** The order must reach this subtotal (satang) before the code applies. */
    minOrderSatang: bigint({ mode: 'number' }).notNull().default(0),
    validFrom: timestamp({ withTimezone: true }),
    validUntil: timestamp({ withTimezone: true }),
    /** Reporting rollup: revenue on orders that used this code (US-TKT-12). */
    revenueAttributedSatang: bigint({ mode: 'number' }).notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
    version: version(),
  },
  (t) => [
    unique('uq_discount_codes_org_event_code').on(
      t.organizationId,
      t.eventId,
      t.code,
    ),
    index('ix_discount_codes_event').on(t.eventId),
    index('ix_discount_codes_org').on(t.organizationId),
    check('ck_discount_codes_used', sql`${t.used} >= 0`),
    check('ck_discount_codes_limit', sql`${t.redemptionLimit} >= 0`),
    check('ck_discount_codes_per_person', sql`${t.perPersonLimit} >= 0`),
    check('ck_discount_codes_min_order', sql`${t.minOrderSatang} >= 0`),
    // percent must land in 1–100; fixed is any positive satang amount.
    check(
      'ck_discount_codes_value',
      sql`(${t.type} = 'percent' AND ${t.value} BETWEEN 1 AND 100) OR (${t.type} = 'fixed' AND ${t.value} >= 1)`,
    ),
  ],
);
