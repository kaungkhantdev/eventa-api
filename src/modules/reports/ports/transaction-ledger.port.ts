/**
 * What Reports needs to show a transaction ledger (US-RPT-06), without reading
 * the payments tables.
 *
 * Implemented by Payments. Two legs of one scan — a charge and a reversal are
 * different events with different times, and the story requires both to appear
 * as their own rows: "the refund appears as a new entry and the original
 * payment is marked Refunded — the original amount is never rewritten".
 */

/** Which side of the ledger an entry is. */
export type LedgerKind = 'payment' | 'refund';

/**
 * How an entry ended up.
 *
 * `refunded` belongs to a PAYMENT that has been reversed, not to the refund
 * itself — the refund's own outcome is `succeeded`, `pending` or `failed`.
 */
export const LEDGER_OUTCOMES = [
  'succeeded',
  'pending',
  'refunded',
  'failed',
] as const;
export type LedgerOutcome = (typeof LEDGER_OUTCOMES)[number];

export interface LedgerEntry {
  /** `payment:<id>` or `refund:<id>` — stable, and never collides across legs. */
  id: string;
  kind: LedgerKind;
  /**
   * What to quote when investigating.
   *
   * A payment's own `txn`. A refund has no human reference in the schema at
   * all, so its own is DERIVED as the parent's txn with a sequence suffix —
   * `TXN-8842-R1`. Useful to read and to say out loud; not an identifier
   * anything stores, and not one to look up by.
   */
  reference: string;
  at: Date;
  /** The payer. A group booking of six has one, so this is not an attendee. */
  personName: string;
  eventId: string;
  eventName: string;
  /**
   * The method, as the schema knows it: `Card`, never `Visa`. Card brand is
   * not stored anywhere and under PCI SAQ-A it is not going to be.
   */
  method: string;
  /** Always POSITIVE. A refund's sign belongs to the screen, not the ledger. */
  amountSatang: number;
  outcome: LedgerOutcome;
  /** The payment this row concerns — the refund's parent, for the detail link. */
  paymentId: string;
}

export interface LedgerQuery {
  /** When the money moved. */
  from: Date;
  /** Exclusive. */
  to: Date;
  eventId?: string;
  /** Matches the payer's name or the payment's `txn`. */
  search?: string;
  page: number;
  limit: number;
}

/**
 * Sums over the whole filter, not the page.
 *
 * `failed` is counted but its money is NOT in `collectedSatang` — the story is
 * explicit that a failed charge is excluded from the payments total while still
 * counting towards the success rate.
 */
export interface LedgerTotals {
  entries: number;
  payments: number;
  failed: number;
  refunds: number;
  collectedSatang: number;
  refundedSatang: number;
}

export interface LedgerPage {
  rows: LedgerEntry[];
  matchedEntries: number;
  totals: LedgerTotals;
}

export abstract class TransactionLedgerPort {
  abstract ledger(
    organizationId: number,
    query: LedgerQuery,
  ): Promise<LedgerPage>;
}
