import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, idPk, updatedAt, version } from './_columns';
import { citext } from './_types';
import {
  attendeeTagEnum,
  holdStatusEnum,
  issuedTicketStatusEnum,
  orderStatusEnum,
  paymentStatusEnum,
} from './enums';
import { events } from './events';
import { users } from './identity';
import { organizations } from './organizations';
import { discountCodes } from './promotions';
import { seats } from './seating';
import { ticketTypes } from './ticketing';

/** A person in the org's attendee CRM. Guest (no user) or linked to a portal user. */
export const attendees = pgTable(
  'attendees',
  {
    id: idPk(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    email: citext().notNull(),
    phone: text(),
    company: text(),
    jobRole: text(),
    tag: attendeeTagEnum(),
    initials: text(),
    firstSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
    version: version(),
  },
  (t) => [
    unique('uq_attendees_org_email').on(t.organizationId, t.email),
    index('ix_attendees_org').on(t.organizationId),
    index('ix_attendees_tag').on(t.organizationId, t.tag),
  ],
);

/** The booking header — the "registration" as a commerce order. Money is satang. */
export const orders = pgTable(
  'orders',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    reference: text().notNull(),
    eventId: uuid()
      .notNull()
      .references(() => events.id, { onDelete: 'restrict' }),
    attendeeId: bigint({ mode: 'number' }).references(() => attendees.id, {
      onDelete: 'set null',
    }),
    buyerName: text().notNull(),
    buyerEmail: citext().notNull(),
    buyerPhone: text(),
    status: orderStatusEnum().notNull().default('pending'),
    paymentStatus: paymentStatusEnum().notNull().default('pending'),
    seats: smallint().notNull(),
    subtotalSatang: bigint({ mode: 'number' }).notNull(),
    discountCodeId: uuid().references(() => discountCodes.id, {
      onDelete: 'set null',
    }),
    discountAmountSatang: bigint({ mode: 'number' }).notNull().default(0),
    vatAmountSatang: bigint({ mode: 'number' }).notNull().default(0),
    totalSatang: bigint({ mode: 'number' }).notNull(),
    currency: char({ length: 3 }).notNull().default('THB'),
    registeredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    version: version(),
  },
  (t) => [
    unique('uq_orders_org_reference').on(t.organizationId, t.reference),
    index('ix_orders_event').on(t.eventId),
    index('ix_orders_attendee').on(t.attendeeId),
    index('ix_orders_status').on(t.organizationId, t.status),
    index('ix_orders_discount').on(t.discountCodeId),
    check('ck_orders_seats', sql`${t.seats} BETWEEN 1 AND 8`),
    check(
      'ck_orders_money',
      sql`${t.subtotalSatang} >= 0 AND ${t.discountAmountSatang} >= 0 AND ${t.vatAmountSatang} >= 0 AND ${t.totalSatang} >= 0`,
    ),
  ],
);

/**
 * One application of a discount code to an order (US-TKT-11). It lives here
 * rather than in `promotions.ts` because it points at `orders`, which would make
 * the two schema modules import each other.
 *
 * The unique pair makes re-submitting the same code on the same order a no-op,
 * and the row set is what `discount_codes.used` counts — so releasing a
 * cancelled order's redemption frees the code for someone else.
 */
export const discountRedemptions = pgTable(
  'discount_redemptions',
  {
    id: idPk(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    discountCodeId: uuid()
      .notNull()
      .references(() => discountCodes.id, { onDelete: 'restrict' }),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    /** Who redeemed it — drives the per-person limit without joining orders. */
    buyerEmail: citext().notNull(),
    amountSatang: bigint({ mode: 'number' }).notNull(),
    redeemedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_discount_redemptions_code_order').on(
      t.discountCodeId,
      t.orderId,
    ),
    index('ix_discount_redemptions_code').on(t.discountCodeId),
    index('ix_discount_redemptions_order').on(t.orderId),
    index('ix_discount_redemptions_buyer').on(t.discountCodeId, t.buyerEmail),
    check('ck_discount_redemptions_amount', sql`${t.amountSatang} >= 0`),
  ],
);

/** Line item: a quantity of one ticket type within an order. */
export const orderItems = pgTable(
  'order_items',
  {
    id: idPk(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    ticketTypeId: uuid()
      .notNull()
      .references(() => ticketTypes.id, { onDelete: 'restrict' }),
    quantity: smallint().notNull(),
    unitPriceSatang: bigint({ mode: 'number' }).notNull(),
    lineSubtotalSatang: bigint({ mode: 'number' }).notNull(),
    currency: char({ length: 3 }).notNull().default('THB'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('uq_order_items_order_ticket_type').on(t.orderId, t.ticketTypeId),
    index('ix_order_items_order').on(t.orderId),
    index('ix_order_items_ticket_type').on(t.ticketTypeId),
    check('ck_order_items_qty', sql`${t.quantity} >= 1`),
  ],
);

/** One issued admission ticket per admitted person/seat, carrying a signed QR. */
export const tickets = pgTable(
  'tickets',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    orderItemId: bigint({ mode: 'number' })
      .notNull()
      .references(() => orderItems.id, { onDelete: 'cascade' }),
    eventId: uuid()
      .notNull()
      .references(() => events.id, { onDelete: 'restrict' }),
    ticketTypeId: uuid()
      .notNull()
      .references(() => ticketTypes.id, { onDelete: 'restrict' }),
    attendeeId: bigint({ mode: 'number' }).references(() => attendees.id, {
      onDelete: 'set null',
    }),
    qrToken: text().notNull(),
    holderName: text(),
    ticketLabel: text(),
    status: issuedTicketStatusEnum().notNull().default('issued'),
    checkedInAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
    version: version(),
  },
  (t) => [
    unique('uq_tickets_qr_token').on(t.qrToken),
    index('ix_tickets_order').on(t.orderId),
    index('ix_tickets_event').on(t.eventId),
    index('ix_tickets_attendee').on(t.attendeeId),
    index('ix_tickets_status').on(t.eventId, t.status),
  ],
);

/** Binds an issued ticket to a specific seat (a seat holds one live assignment). */
export const seatAssignments = pgTable(
  'seat_assignments',
  {
    id: idPk(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    seatId: bigint({ mode: 'number' })
      .notNull()
      .references(() => seats.id, { onDelete: 'restrict' }),
    ticketId: uuid()
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    assignedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex('uq_seat_active')
      .on(t.seatId)
      .where(sql`${t.releasedAt} IS NULL`),
    unique('uq_seat_assignments_ticket').on(t.ticketId),
    index('ix_seat_assignments_seat').on(t.seatId),
    index('ix_seat_assignments_ticket').on(t.ticketId),
  ],
);

/** Short-lived checkout reservation that expires and releases inventory. */
export const seatHolds = pgTable(
  'seat_holds',
  {
    id: idPk(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    eventId: uuid()
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    orderId: uuid().references(() => orders.id, { onDelete: 'set null' }),
    ticketTypeId: uuid().references(() => ticketTypes.id, {
      onDelete: 'cascade',
    }),
    seatId: bigint({ mode: 'number' }).references(() => seats.id, {
      onDelete: 'cascade',
    }),
    quantity: integer().notNull().default(1),
    status: holdStatusEnum().notNull().default('active'),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('uq_seat_hold_active')
      .on(t.seatId)
      .where(sql`${t.status} = 'active'`),
    index('ix_seat_holds_expiry')
      .on(t.expiresAt)
      .where(sql`${t.status} = 'active'`),
    index('ix_seat_holds_order').on(t.orderId),
    // Money-path backstop (mirrors order_items/orders): a hold reserves ≥ 1 unit.
    check('ck_seat_holds_qty', sql`${t.quantity} >= 1`),
  ],
);
