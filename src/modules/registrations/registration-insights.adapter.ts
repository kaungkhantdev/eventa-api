import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { events, orderItems, orders, ticketTypes } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import {
  type RecentRegistration,
  RegistrationInsightsPort,
  type RegistrationTotals,
  type TierShare,
} from '../dashboard/ports/registration-insights.port';

/** A sign-up counts once it is confirmed — a pending one may never happen. */
const COUNTED = 'confirmed';
/** The two states awaiting an organizer, mirroring `registration-decision.ts`. */
const AWAITING = ['pending', 'waitlisted'] as const;

/**
 * Registrations' implementation of the Dashboard-owned insights port
 * (US-DASH-02/08/10/12), so the dashboard summarizes sign-ups without reading
 * `orders` itself.
 *
 * Every figure counts CONFIRMED registrations only, and every query is scoped
 * by `organization_id` inside `withTenant`. The dashboard has no way to name a
 * workspace: the tenant arrives from the authenticated caller and is passed
 * straight through.
 */
@Injectable()
export class RegistrationInsightsAdapter extends RegistrationInsightsPort {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {
    super();
  }

  async countSince(organizationId: number, since: Date): Promise<number> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(orders)
        .where(
          and(
            eq(orders.organizationId, organizationId),
            eq(orders.status, COUNTED),
            gte(orders.registeredAt, since),
          ),
        );
      return row.count;
    });
  }

  async recent(
    organizationId: number,
    limit: number,
  ): Promise<RecentRegistration[]> {
    return withTenant(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select({
          orderId: orders.id,
          attendeeName: orders.buyerName,
          eventName: events.name,
          ticketTypeName: ticketTypes.name,
          totalSatang: orders.totalSatang,
          paymentStatus: orders.paymentStatus,
          registeredAt: orders.registeredAt,
        })
        .from(orders)
        .innerJoin(events, eq(events.id, orders.eventId))
        // Left, not inner: an order whose tier was deleted must still appear —
        // dropping the row would make the table disagree with the count above.
        .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
        .leftJoin(ticketTypes, eq(ticketTypes.id, orderItems.ticketTypeId))
        .where(eq(orders.organizationId, organizationId))
        .orderBy(desc(orders.registeredAt), desc(orders.id))
        .limit(limit);
      return rows.map((row) => ({
        ...row,
        totalSatang: Number(row.totalSatang),
      }));
    });
  }

  async totalsForPeriod(
    organizationId: number,
    period: { from: Date; to: Date; previousFrom: Date; previousTo: Date },
  ): Promise<RegistrationTotals> {
    return withTenant(this.db, organizationId, async (tx) => {
      // Both halves in ONE scan, so the comparison describes one instant.
      const [row] = await tx
        .select({
          // ISO strings with an explicit cast: a raw `Date` interpolated into
          // a `sql` template serializes as a locale string Postgres cannot
          // parse. Drizzle's column comparisons handle it; a FILTER does not.
          current: sql<number>`count(*) FILTER (
            WHERE ${orders.registeredAt} >= ${period.from.toISOString()}::timestamptz
              AND ${orders.registeredAt} < ${period.to.toISOString()}::timestamptz)::int`,
          previous: sql<number>`count(*) FILTER (
            WHERE ${orders.registeredAt} >= ${period.previousFrom.toISOString()}::timestamptz
              AND ${orders.registeredAt} < ${period.previousTo.toISOString()}::timestamptz)::int`,
        })
        .from(orders)
        .where(
          and(
            eq(orders.organizationId, organizationId),
            eq(orders.status, COUNTED),
            gte(orders.registeredAt, period.previousFrom),
            lt(orders.registeredAt, period.to),
          ),
        );
      return row;
    });
  }

  async tierMix(
    organizationId: number,
    period: { from: Date; to: Date },
  ): Promise<TierShare[]> {
    return withTenant(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select({
          ticketTypeName: ticketTypes.name,
          count: sql<number>`count(*)::int`,
        })
        .from(orders)
        .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
        .innerJoin(ticketTypes, eq(ticketTypes.id, orderItems.ticketTypeId))
        .where(
          and(
            eq(orders.organizationId, organizationId),
            eq(orders.status, COUNTED),
            gte(orders.registeredAt, period.from),
            lt(orders.registeredAt, period.to),
          ),
        )
        .groupBy(ticketTypes.name)
        .orderBy(desc(sql`count(*)`));
      return rows;
    });
  }

  async countAwaitingDecision(organizationId: number): Promise<number> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(orders)
        .where(
          and(
            eq(orders.organizationId, organizationId),
            inArray(orders.status, [...AWAITING]),
          ),
        );
      return row.count;
    });
  }
}
