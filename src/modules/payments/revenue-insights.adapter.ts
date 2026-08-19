import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { orders, payments, refunds } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import {
  RevenueInsightsPort,
  type RevenuePoint,
  type RevenueTotals,
} from '../dashboard/ports/revenue-insights.port';

const PAID = 'paid';
const FAILED = 'failed';

/**
 * Payments' implementation of the Dashboard-owned revenue port (US-DASH-08/09),
 * so the dashboard reports money without reading `payments` itself.
 *
 * "Revenue" here means what US-DASH-08's note means: **net of VAT and refunds**.
 * The VAT is the order's own `vat_amount_satang` — it was never the organizer's
 * money, it is the Revenue Department's, and it is reported separately by the
 * VAT ledger (US-FIN-11). Refunds come off at their full amount. Doing this
 * subtraction HERE rather than on the dashboard is the point of the port: only
 * this module knows which of those figures mean what.
 *
 * Every amount is integer satang, and the arithmetic stays in Postgres so a
 * large period never marshals a row per payment to add up in JavaScript.
 */
@Injectable()
export class RevenueInsightsAdapter extends RevenueInsightsPort {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {
    super();
  }

  async totalsForPeriod(
    organizationId: number,
    period: { from: Date; to: Date; previousFrom: Date; previousTo: Date },
  ): Promise<RevenueTotals> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({
          current: this.netIn(period.from, period.to),
          previous: this.netIn(period.previousFrom, period.previousTo),
        })
        .from(payments)
        .innerJoin(orders, eq(orders.id, payments.orderId))
        .where(
          and(
            eq(payments.organizationId, organizationId),
            eq(payments.status, PAID),
            gte(payments.paidAt, period.previousFrom),
            lt(payments.paidAt, period.to),
          ),
        );
      return { current: Number(row.current), previous: Number(row.previous) };
    });
  }

  async trend(
    organizationId: number,
    period: { from: Date; to: Date },
  ): Promise<RevenuePoint[]> {
    return withTenant(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select({
          // Bucketed in BANGKOK time, so a payment at 22:00 local lands on the
          // day the organizer thinks it did rather than the next UTC one.
          at: sql<Date>`date_trunc('day', ${payments.paidAt} AT TIME ZONE 'Asia/Bangkok')`,
          netSatang: sql<number>`coalesce(sum(
            ${payments.amountSatang} - coalesce(${orders.vatAmountSatang}, 0)
          ), 0)::bigint`,
        })
        .from(payments)
        .innerJoin(orders, eq(orders.id, payments.orderId))
        .where(
          and(
            eq(payments.organizationId, organizationId),
            eq(payments.status, PAID),
            gte(payments.paidAt, period.from),
            lt(payments.paidAt, period.to),
          ),
        )
        .groupBy(
          sql`date_trunc('day', ${payments.paidAt} AT TIME ZONE 'Asia/Bangkok')`,
        )
        .orderBy(
          sql`date_trunc('day', ${payments.paidAt} AT TIME ZONE 'Asia/Bangkok')`,
        );
      return rows.map((row) => ({
        at: new Date(row.at),
        netSatang: Number(row.netSatang),
      }));
    });
  }

  async countDeclined(organizationId: number): Promise<number> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(payments)
        .innerJoin(orders, eq(orders.id, payments.orderId))
        .where(
          and(
            eq(payments.organizationId, organizationId),
            eq(payments.status, FAILED),
            // Only while the order is still open: a failure on an order since
            // cancelled or paid another way is history, not something to act on.
            eq(orders.status, 'pending'),
          ),
        );
      return row.count;
    });
  }

  /**
   * Net takings in a window: what settled, less the VAT it carried, less
   * anything refunded against it. The refund is a correlated subquery rather
   * than a join so a payment refunded twice cannot multiply its own row.
   */
  private netIn(from: Date, to: Date) {
    // ISO strings with an explicit cast: a raw `Date` interpolated into a `sql`
    // template serializes as a locale string Postgres cannot parse. Drizzle's
    // own column comparisons handle this; a hand-written FILTER does not.
    return sql<number>`coalesce(sum(
      ${payments.amountSatang}
        - coalesce(${orders.vatAmountSatang}, 0)
        - coalesce((
            SELECT sum(${refunds.amountSatang})
            FROM ${refunds}
            WHERE ${refunds.paymentId} = ${payments.id}
          ), 0)
    ) FILTER (WHERE ${payments.paidAt} >= ${from.toISOString()}::timestamptz
                AND ${payments.paidAt} < ${to.toISOString()}::timestamptz), 0)::bigint`;
  }
}
