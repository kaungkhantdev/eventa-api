import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, ilike, inArray, lt, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { events, orders, payments, refunds } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import {
  IncomeReportPort,
  type EventNet,
  type IncomePage,
  type IncomeQuery,
  type IncomeSummary,
  type IncomeWindow,
} from '../reports/ports/income-report.port';
import type { NetRevenueDay } from '../reports/revenue-trend';

const PAID = 'paid';

/**
 * Payments' implementation of the income report (US-RPT-05), so Reports never
 * reads a payments table.
 *
 * `net` uses the SAME arithmetic as `RevenueInsightsAdapter.netIn` — amount,
 * less the order's VAT, less refunds raised against that payment. That is not a
 * coincidence to be maintained by hand: US-RPT-01 requires the overview's
 * revenue to equal this report's net for the same scope, and the only way that
 * holds is for one definition to serve both.
 *
 * Fees come off separately as `settled`, which is what reconciliation actually
 * needs: the organizer compares the bank against that, not against net.
 *
 * The arithmetic stays in Postgres — a year of payments must not marshal a row
 * each into JavaScript to be added up.
 */
@Injectable()
export class IncomeReportAdapter extends IncomeReportPort {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {
    super();
  }

  async incomeByEvent(
    organizationId: number,
    query: IncomeQuery,
  ): Promise<IncomePage> {
    return withTenant(this.db, organizationId, async (tx) => {
      const where = this.matching(organizationId, query);
      const columns = this.money();

      const rows = await tx
        .select({
          eventId: events.id,
          eventName: events.name,
          startAt: events.startAt,
          ...columns,
        })
        .from(payments)
        .innerJoin(orders, eq(orders.id, payments.orderId))
        .innerJoin(events, eq(events.id, payments.eventId))
        .where(where)
        .groupBy(events.id, events.name, events.startAt)
        .orderBy(desc(columns.netSatang))
        .limit(query.limit)
        .offset((query.page - 1) * query.limit);

      const [summary] = await tx
        .select({
          ...columns,
          matchedEvents: sql<number>`count(distinct ${payments.eventId})::int`,
        })
        .from(payments)
        .innerJoin(orders, eq(orders.id, payments.orderId))
        .innerJoin(events, eq(events.id, payments.eventId))
        .where(where);

      return {
        rows: rows.map((row) => ({ ...row, ...toNumbers(row) })),
        matchedEvents: Number(summary?.matchedEvents ?? 0),
        totals: toNumbers(summary),
      };
    });
  }

  /**
   * The same sums with no rows attached, for the overview's tiles and the
   * period they are compared against (US-RPT-01).
   */
  async incomeTotals(
    organizationId: number,
    window: IncomeWindow,
  ): Promise<IncomeSummary> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [summary] = await tx
        .select({
          ...this.money(),
          // Seats rather than orders: a group booking of six sold six tickets,
          // and the average price divides by tickets. One paid payment per
          // order, the same assumption the VAT sum above already makes.
          paidSeats: sql<string>`coalesce(sum(${orders.seats}), 0)::bigint`,
        })
        .from(payments)
        .innerJoin(orders, eq(orders.id, payments.orderId))
        .innerJoin(events, eq(events.id, payments.eventId))
        .where(this.matching(organizationId, window));

      return {
        ...toNumbers(summary),
        paidSeats: Number(summary?.paidSeats ?? 0),
      };
    });
  }

  /**
   * Net revenue per Bangkok calendar day, for the overview's trend chart.
   *
   * Bucketed in Bangkok time so a payment at 22:00 local lands on the day the
   * organizer thinks it did rather than the next UTC one, and returned as a
   * `YYYY-MM-DD` string: a bare timestamp would be re-interpreted in whatever
   * timezone the process happens to run in.
   *
   * Only days with takings. The window's quiet days are zero-filled by
   * `bucketRevenue`, where that rule can be tested without a database.
   */
  async netByDay(
    organizationId: number,
    window: IncomeWindow,
  ): Promise<NetRevenueDay[]> {
    return withTenant(this.db, organizationId, async (tx) => {
      const day = sql`date_trunc('day', ${payments.paidAt} AT TIME ZONE 'Asia/Bangkok')`;
      const rows = await tx
        .select({
          day: sql<string>`to_char(${day}, 'YYYY-MM-DD')`,
          netSatang: this.money().netSatang,
        })
        .from(payments)
        .innerJoin(orders, eq(orders.id, payments.orderId))
        .innerJoin(events, eq(events.id, payments.eventId))
        .where(this.matching(organizationId, window))
        .groupBy(day)
        .orderBy(day);

      return rows.map((row) => ({
        day: row.day,
        netSatang: Number(row.netSatang),
      }));
    });
  }

  /**
   * Net takings for a handful of named events, all time (US-RPT-04).
   *
   * No window on `paid_at`: the event-performance report windows on when an
   * event RUNS, and an event's revenue is its revenue — a conference whose
   * tickets sold last month has not earned nothing.
   *
   * Same `net` expression as everywhere else in this adapter, so the figure
   * beside an event here and the figure in the income report are the same one.
   */
  async netByEvents(
    organizationId: number,
    eventIds: string[],
  ): Promise<EventNet[]> {
    // An empty IN () is not valid SQL, and there is nothing to ask anyway.
    if (eventIds.length === 0) return [];

    return withTenant(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select({
          eventId: payments.eventId,
          netSatang: this.money().netSatang,
        })
        .from(payments)
        .innerJoin(orders, eq(orders.id, payments.orderId))
        .where(
          and(
            eq(payments.organizationId, organizationId),
            eq(payments.status, PAID),
            inArray(payments.eventId, eventIds),
          ),
        )
        .groupBy(payments.eventId);

      return rows.map((row) => ({
        eventId: row.eventId,
        netSatang: Number(row.netSatang),
      }));
    });
  }

  /** One predicate for the page and its totals, so they cannot diverge. */
  private matching(organizationId: number, query: IncomeWindow) {
    return and(
      eq(payments.organizationId, organizationId),
      eq(payments.status, PAID),
      gte(payments.paidAt, query.from),
      lt(payments.paidAt, query.to),
      query.eventId ? eq(payments.eventId, query.eventId) : undefined,
      query.search ? ilike(events.name, `%${query.search}%`) : undefined,
    );
  }

  /**
   * The five sums and the two bottom lines.
   *
   * Refunds are correlated per payment rather than joined: a payment with two
   * refunds would otherwise duplicate its own amount into every other sum in
   * the row.
   */
  private money() {
    const refunded = sql<string>`coalesce((
      SELECT sum(${refunds.amountSatang})
      FROM ${refunds}
      WHERE ${refunds.paymentId} = ${payments.id}
    ), 0)`;
    return {
      grossSatang: sql<string>`coalesce(sum(${payments.amountSatang}), 0)::bigint`,
      vatSatang: sql<string>`coalesce(sum(coalesce(${orders.vatAmountSatang}, 0)), 0)::bigint`,
      refundsSatang: sql<string>`coalesce(sum(${refunded}), 0)::bigint`,
      feesSatang: sql<string>`coalesce(sum(coalesce(${payments.feeAmountSatang}, 0)), 0)::bigint`,
      netSatang: sql<string>`coalesce(sum(
        ${payments.amountSatang} - coalesce(${orders.vatAmountSatang}, 0) - ${refunded}
      ), 0)::bigint`,
      settledSatang: sql<string>`coalesce(sum(
        ${payments.amountSatang} - coalesce(${orders.vatAmountSatang}, 0) - ${refunded}
          - coalesce(${payments.feeAmountSatang}, 0)
      ), 0)::bigint`,
    };
  }
}

/** `::bigint` arrives as a string; satang are integers and belong as numbers. */
function toNumbers(row: Record<string, unknown> | undefined) {
  return {
    grossSatang: Number(row?.grossSatang ?? 0),
    vatSatang: Number(row?.vatSatang ?? 0),
    refundsSatang: Number(row?.refundsSatang ?? 0),
    feesSatang: Number(row?.feesSatang ?? 0),
    netSatang: Number(row?.netSatang ?? 0),
    settledSatang: Number(row?.settledSatang ?? 0),
  };
}
