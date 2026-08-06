import type { MonthlyTakings } from '../tax-periods.types';

/**
 * The VAT ledger's view of what was actually collected. Tax periods own the
 * abstraction (DIP); Payments — which owns the `payments` and `refunds` ledgers
 * — binds the adapter, so nothing here reads those tables directly.
 *
 * Takings are assigned to a month by the date the MONEY MOVED, not the date of
 * the sale: a June ticket refunded in July reverses July's VAT, not June's.
 * That is what makes "an adjustment to an already-filed period carries into the
 * next open period" (US-FIN-12) fall out for free instead of needing a
 * carry-forward ledger.
 */
export abstract class TaxableSalesPort {
  /** One entry per month that saw money move, in Bangkok time. */
  abstract totalsByMonth(
    organizationId: number,
    year: number,
  ): Promise<MonthlyTakings[]>;
}
