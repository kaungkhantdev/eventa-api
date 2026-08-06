import {
  bigint,
  char,
  date,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idPk, updatedAt, version } from './_columns';
import { citext } from './_types';
import {
  invoiceStatusEnum,
  payoutStatusEnum,
  paymentMethodEnum,
  taxStatusEnum,
} from './enums';
import { events } from './events';
import { organizations } from './organizations';
import { orders } from './registration';
import { payments } from './payments';
import { users } from './identity';

/**
 * A tax invoice for an order (US-FIN-06/07/08/10). Thai VAT invoices are legal
 * documents: once issued the numbering may not be reused and the figures may
 * not be edited, so a correction is a VOID plus a new invoice, never an update.
 */
export const invoices = pgTable(
  'invoices',
  {
    id: idPk(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** `INV-YYYY-NNNN`, unique per workspace and never reused. */
    number: text().notNull(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    eventId: uuid()
      .notNull()
      .references(() => events.id, { onDelete: 'restrict' }),
    buyerName: text().notNull(),
    /**
     * Snapshotted at issue, not read through to the order: a tax invoice must
     * still show who it was billed to after the buyer edits their account.
     */
    buyerEmail: citext().notNull(),
    issuedAt: date().notNull(),
    /** Terms are 14 days from issue; what "overdue" is measured against. */
    dueAt: date().notNull(),
    subtotalSatang: bigint({ mode: 'number' }).notNull(),
    vatAmountSatang: bigint({ mode: 'number' }).notNull(),
    amountSatang: bigint({ mode: 'number' }).notNull(),
    currency: char({ length: 3 }).notNull().default('THB'),
    status: invoiceStatusEnum().notNull().default('issued'),
    paidVia: paymentMethodEnum(),
    paidOn: date(),
    /** Set when an Admin voids it (US-FIN-10); the number is still never reused. */
    voidedAt: timestamp({ withTimezone: true }),
    voidReason: text(),
    voidedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    unique('uq_invoices_org_number').on(t.organizationId, t.number),
    index('ix_invoices_order').on(t.orderId),
    index('ix_invoices_event').on(t.eventId),
    index('ix_invoices_status').on(t.organizationId, t.status),
    // Ageing is judged on `due_at`, and the ledger sorts newest-issued first.
    index('ix_invoices_due').on(t.organizationId, t.dueAt),
  ],
);

/** A settlement of net proceeds to the organizer's bank account (US-FIN-03/04). */
export const payouts = pgTable(
  'payouts',
  {
    id: idPk(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    reference: text().notNull(),
    amountSatang: bigint({ mode: 'number' }).notNull(),
    currency: char({ length: 3 }).notNull().default('THB'),
    /** Masked descriptor only — this service never stores an account number. */
    bankAccount: text().notNull(),
    status: payoutStatusEnum().notNull().default('scheduled'),
    periodCovered: text(),
    eventId: uuid().references(() => events.id, { onDelete: 'set null' }),
    requestedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    unique('uq_payouts_org_reference').on(t.organizationId, t.reference),
    index('ix_payouts_status').on(t.organizationId, t.status),
    index('ix_payouts_event').on(t.eventId),
  ],
);

/**
 * Which payments a payout settles, net of refunds and fees. The unique on
 * `payment_id` alone is the important one: a payment may settle in at most ONE
 * payout, so the same money can never be paid out twice.
 */
export const payoutItems = pgTable(
  'payout_items',
  {
    id: idPk(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    payoutId: bigint({ mode: 'number' })
      .notNull()
      .references(() => payouts.id, { onDelete: 'cascade' }),
    paymentId: uuid()
      .notNull()
      .references(() => payments.id, { onDelete: 'restrict' }),
    grossSatang: bigint({ mode: 'number' }).notNull(),
    refundSatang: bigint({ mode: 'number' }).notNull().default(0),
    feeSatang: bigint({ mode: 'number' }).notNull().default(0),
    /** gross − refund − fee. */
    netSatang: bigint({ mode: 'number' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('uq_payout_items_payout_payment').on(t.payoutId, t.paymentId),
    unique('uq_payout_items_payment').on(t.paymentId),
    index('ix_payout_items_payout').on(t.payoutId),
    index('ix_payout_items_payment').on(t.paymentId),
  ],
);

/**
 * A monthly VAT filing period (US-FIN-11/12). The figures are RECOMPUTED from
 * confirmed registrations net of refunds rather than accumulated, so a refund
 * backdated into an open period corrects itself; a filed period is frozen.
 */
export const taxPeriods = pgTable(
  'tax_periods',
  {
    id: idPk(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Month label, e.g. `Jun`. */
    period: text().notNull(),
    year: smallint().notNull(),
    /** The 15th of the following month, per Thai filing rules. */
    dueAt: date().notNull(),
    salesSatang: bigint({ mode: 'number' }).notNull(),
    vatSatang: bigint({ mode: 'number' }).notNull(),
    whtSatang: bigint({ mode: 'number' }).notNull().default(0),
    remittedSatang: bigint({ mode: 'number' }).notNull().default(0),
    currency: char({ length: 3 }).notNull().default('THB'),
    status: taxStatusEnum().notNull().default('upcoming'),
    filedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    unique('uq_tax_periods_org_period').on(t.organizationId, t.period, t.year),
    index('ix_tax_periods_org').on(t.organizationId),
  ],
);
