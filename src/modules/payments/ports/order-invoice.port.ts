import type { Tx } from '../../../db/tenant';

/** The order's money landed. */
export interface InvoicePaidInput {
  organizationId: number;
  orderId: string;
  /** A `payment_method` value — how the money arrived. */
  method: string;
  /** When it cleared; the invoice prints the Bangkok calendar day of it. */
  paidAt: Date;
}

/** The order's money went back. */
export interface InvoiceRefundedInput {
  organizationId: number;
  orderId: string;
  /** Who issued the refund — the void is recorded as theirs. */
  actorUserId: string;
  now: Date;
}

/**
 * The tax invoice raised against an order, kept in step with the money behind
 * it. An invoice can be issued before the order is paid, so it learns of the
 * payment here rather than only at issue (US-FIN-06/07); and a refunded sale's
 * invoice is voided here, since a paid invoice is only ever voided by
 * refunding its payment (US-FIN-02, US-FIN-10).
 *
 * Both run INSIDE the caller's settlement or refund transaction, so the
 * invoice and the ledger line commit together or not at all. An order with no
 * invoice is a no-op.
 *
 * Payments owns the abstraction; Invoices — which owns the `invoices` table —
 * binds the adapter.
 */
export abstract class OrderInvoicePort {
  abstract markPaidIn(tx: Tx, input: InvoicePaidInput): Promise<void>;

  abstract voidForRefundIn(tx: Tx, input: InvoiceRefundedInput): Promise<void>;
}
