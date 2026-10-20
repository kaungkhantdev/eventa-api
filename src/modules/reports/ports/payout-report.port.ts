import { REPORT_PAYOUT_STATUSES } from '../../../common/constants/reports.constants';
/**
 * What Reports needs to show payouts and settlement (US-RPT-07), without
 * reading the payouts tables.
 *
 * Implemented by Payouts, which owns `payouts` and `payout_items`. The status is
 * the REPORT's vocabulary — the story names exactly three: Paid, In transit and
 * Pending — not the four the table stores. A `failed` payout has no place in
 * that list and is left out of the rows and the tiles alike; it is the Finance
 * Payouts screen's to show, with its retry (US-FIN-04).
 */

export type ReportPayoutStatus = (typeof REPORT_PAYOUT_STATUSES)[number];

/** An event a payout settles money for. */
export interface PayoutCoveredEvent {
  eventId: string;
  eventName: string;
}

export interface PayoutReportRow {
  /** Unique within the workspace — what the organizer quotes to their bank. */
  reference: string;
  /** When it landed, or when it was requested if it has not yet. */
  at: Date;
  /** Already masked by the owner, to the last four digits (US-RPT-07). */
  bankAccount: string;
  /**
   * Every event whose payments this payout settles, by name. Empty for a payout
   * that carries no items — it covers nothing an event filter could match.
   */
  events: PayoutCoveredEvent[];
  amountSatang: number;
  status: ReportPayoutStatus;
}

export interface PayoutReportQuery {
  /** When the payout landed, or was requested if it has not yet. */
  from: Date;
  /** Exclusive. */
  to: Date;
  /**
   * A payout covering several events matches ANY of them (US-RPT-07): the
   * filter asks "does this payout settle money for that event", not "is that
   * its only event".
   */
  eventId?: string;
  /** Matches the payout's reference or the name of an event it covers. */
  search?: string;
  page: number;
  limit: number;
}

/**
 * Sums over the whole filter, not the page — each payout counted once however
 * many events it covers, at its whole amount.
 */
export interface PayoutReportTotals {
  payouts: number;
  paidOutSatang: number;
  inTransitSatang: number;
  /**
   * Scheduled and not yet sent. NOT the same figure as `GET /payouts/balances`'
   * `pendingSatang`, which also counts what is in transit (US-FIN-03).
   */
  pendingSatang: number;
}

export interface PayoutReportPage {
  rows: PayoutReportRow[];
  matchedPayouts: number;
  totals: PayoutReportTotals;
}

export abstract class PayoutReportPort {
  abstract payouts(
    organizationId: number,
    query: PayoutReportQuery,
  ): Promise<PayoutReportPage>;
}
