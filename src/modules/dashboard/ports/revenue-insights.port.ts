/** One point on the revenue trend (US-DASH-09). `at` is a Bangkok day start. */
export interface RevenuePoint {
  at: Date;
  netSatang: number;
}

export interface RevenueTotals {
  current: number;
  previous: number;
}

/**
 * What the dashboard needs to know about money, without reading payments.
 *
 * Every figure is **net of VAT and refunds** (US-DASH-08's note), computed by
 * Payments — which owns what those words mean — rather than by the dashboard
 * subtracting things it half-understands. Integer satang throughout.
 *
 * Nothing here is safe to show without `finView`; the gate is applied by the
 * dashboard service before any of it is fetched, so an unauthorized caller does
 * not merely have the number hidden — it is never read.
 */
export abstract class RevenueInsightsPort {
  abstract totalsForPeriod(
    organizationId: number,
    period: { from: Date; to: Date; previousFrom: Date; previousTo: Date },
  ): Promise<RevenueTotals>;

  /** The period bucketed by day, oldest first, with empty days at zero. */
  abstract trend(
    organizationId: number,
    period: { from: Date; to: Date },
  ): Promise<RevenuePoint[]>;

  /** Payments that failed and still hold a seat — a critical alert (US-DASH-06). */
  abstract countDeclined(organizationId: number): Promise<number>;
}
