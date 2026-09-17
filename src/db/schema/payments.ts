import {
  bigint,
  char,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, updatedAt } from './_columns';
import {
  paymentMethodEnum,
  paymentStatusEnum,
  refundStatusEnum,
} from './enums';
import { events } from './events';
import { users } from './identity';
import { organizations } from './organizations';
import { orders } from './registration';

/** A captured (or attempted) charge against an order. Append-only ledger. */
export const payments = pgTable(
  'payments',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    txn: text().notNull(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    eventId: uuid()
      .notNull()
      .references(() => events.id, { onDelete: 'restrict' }),
    payerName: text().notNull(),
    method: paymentMethodEnum().notNull(),
    amountSatang: bigint({ mode: 'number' }).notNull(),
    currency: char({ length: 3 }).notNull().default('THB'),
    status: paymentStatusEnum().notNull().default('pending'),
    paidAt: timestamp({ withTimezone: true }),
    gatewayRef: text(),
    /**
     * The connected account the charge was made on; NULL = the platform's own.
     * Stamped at charge time so a refund reverses on the same account even if
     * the workspace has since disconnected or reconnected elsewhere.
     */
    gatewayAccountId: text(),
    statementDescriptor: varchar({ length: 22 }),
    feeAmountSatang: bigint({ mode: 'number' }),
    idempotencyKey: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('uq_payments_org_txn').on(t.organizationId, t.txn),
    unique('uq_payments_org_idem').on(t.organizationId, t.idempotencyKey),
    index('ix_payments_order').on(t.orderId),
    index('ix_payments_event').on(t.eventId),
    index('ix_payments_status').on(t.organizationId, t.status),
  ],
);

/** A full/partial reversal of a payment. Append-only; exactly-once by idem key. */
export const refunds = pgTable(
  'refunds',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    paymentId: uuid()
      .notNull()
      .references(() => payments.id, { onDelete: 'restrict' }),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    amountSatang: bigint({ mode: 'number' }).notNull(),
    currency: char({ length: 3 }).notNull().default('THB'),
    reason: text(),
    status: refundStatusEnum().notNull().default('pending'),
    issuedBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    issuedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    gatewayRef: text(),
    idempotencyKey: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('uq_refunds_org_idem').on(t.organizationId, t.idempotencyKey),
    index('ix_refunds_payment').on(t.paymentId),
    index('ix_refunds_order').on(t.orderId),
  ],
);
