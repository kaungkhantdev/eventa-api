import type { NetRevenueDay } from '../revenue-trend';

/**
 * What Reports needs to know about money, without reading the payments tables
 * (US-RPT-05).
 *
 * Payments implements it, because only Payments knows what these words mean —
 * the same reason `RevenueInsightsPort` exists for the dashboard. `net` here is
 * computed by exactly the arithmetic that port already uses, so the income
 * report and the overview cannot disagree about the same period.
 */

/** One event's money for the window. Integer satang throughout. */
export interface IncomeRow {
  eventId: string;
  eventName: string;
  startAt: Date;
  /** Collected from buyers, VAT included, before anything comes off. */
  grossSatang: number;
  /**
   * The VAT portion of gross.
   *
   * Never the organizer's money — it is the Revenue Department's, and the VAT
   * ledger reports it separately (US-FIN-11). Carried here because US-RPT-05
   * asks to see it for reconciliation.
   */
  vatSatang: number;
  /** Refunded against those payments, at full amount. */
  refundsSatang: number;
  /** Charged by the payment provider. */
  feesSatang: number;
  /**
   * `gross − vat − refunds`. THE revenue figure, matching the dashboard's.
   *
   * Fees are deliberately not in it: this is the number US-RPT-01 requires the
   * overview to agree with, and the overview's revenue is net of VAT and
   * refunds only. What lands in the bank after the provider takes its cut is
   * `settled`, below.
   */
  netSatang: number;
  /** `net − fees` — what actually reaches the organization's account. */
  settledSatang: number;
}

/** The same figures, summed across everything the filter matched. */
export type IncomeTotals = Omit<IncomeRow, 'eventId' | 'eventName' | 'startAt'>;

/**
 * The totals, with the denominator the overview's average ticket price needs
 * (US-RPT-01).
 *
 * Seats rather than orders: a group booking of six sold six tickets, and
 * dividing by orders would report an average six times the real price.
 */
export interface IncomeSummary extends IncomeTotals {
  /** Seats on the orders these payments settled. */
  paidSeats: number;
}

/** The slice of money being asked about, before paging. */
export interface IncomeWindow {
  /** Payments settled inside this window. */
  from: Date;
  /** Exclusive. */
  to: Date;
  eventId?: string;
  /** Matches the event name. */
  search?: string;
}

export interface IncomeQuery extends IncomeWindow {
  page: number;
  limit: number;
}

export interface IncomePage {
  rows: IncomeRow[];
  /** How many events matched, for paging. */
  matchedEvents: number;
  totals: IncomeTotals;
}

export abstract class IncomeReportPort {
  abstract incomeByEvent(
    organizationId: number,
    query: IncomeQuery,
  ): Promise<IncomePage>;

  /**
   * The same sums with no rows attached, for the overview's tiles and for the
   * previous period they are compared against (US-RPT-01). Separate from
   * `incomeByEvent` because the overview never shows a table: fetching, sorting
   * and paging rows nobody will read is work done to throw away.
   */
  abstract incomeTotals(
    organizationId: number,
    window: IncomeWindow,
  ): Promise<IncomeSummary>;

  /**
   * Net revenue per Bangkok calendar day, for the trend chart. Only days with
   * takings; the window's quiet days are filled in by `bucketRevenue`, where the
   * rule can be tested without a database.
   */
  abstract netByDay(
    organizationId: number,
    window: IncomeWindow,
  ): Promise<NetRevenueDay[]>;
}
