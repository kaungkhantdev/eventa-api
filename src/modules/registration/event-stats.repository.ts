import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { orderItems, orders, payments, tickets } from '../../db/schema';
import { withTenant, type Tx } from '../../db/tenant';
import type {
  AttendeesResult,
  EventStatsOverview,
  RegistrationStatusCounts,
  RegistrationsQuery,
  RegistrationsResult,
  StatsPage,
} from '../events/ports/event-stats.port';

const CONFIRMED = 'confirmed';
const PAID = 'paid';
const LIVE_TICKET_STATUSES = ['issued', 'checked_in'] as const;

/** Read-model queries for the event-workspace Monitor (US-EVT-14). Tenant-scoped. */
@Injectable()
export class EventStatsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async overview(
    organizationId: number,
    eventId: string,
  ): Promise<EventStatsOverview> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [reg] = await tx
        .select({ seats: sql<number>`coalesce(sum(${orders.seats}), 0)::int` })
        .from(orders)
        .where(
          and(
            eq(orders.organizationId, organizationId),
            eq(orders.eventId, eventId),
            eq(orders.status, CONFIRMED),
            isNull(orders.deletedAt),
          ),
        );
      const [tk] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(tickets)
        .where(
          and(
            eq(tickets.organizationId, organizationId),
            eq(tickets.eventId, eventId),
            inArray(tickets.status, [...LIVE_TICKET_STATUSES]),
            isNull(tickets.deletedAt),
          ),
        );
      const [rev] = await tx
        .select({
          amount: sql<string>`coalesce(sum(${payments.amountSatang}), 0)::bigint`,
        })
        .from(payments)
        .where(
          and(
            eq(payments.organizationId, organizationId),
            eq(payments.eventId, eventId),
            eq(payments.status, PAID),
          ),
        );
      return {
        registrations: reg.seats,
        ticketsSold: tk.count,
        revenueSatang: Number(rev.amount),
      };
    });
  }

  async registrations(
    organizationId: number,
    eventId: string,
    query: RegistrationsQuery,
  ): Promise<RegistrationsResult> {
    return withTenant(this.db, organizationId, async (tx) => {
      const base = and(
        eq(orders.organizationId, organizationId),
        eq(orders.eventId, eventId),
        isNull(orders.deletedAt),
      );
      const where = query.status
        ? and(base, eq(orders.paymentStatus, query.status))
        : base;

      const [{ total }] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(orders)
        .where(where);
      const rows = await tx
        .select({
          id: orders.id,
          reference: orders.reference,
          attendeeName: orders.buyerName,
          amountSatang: orders.totalSatang,
          paymentStatus: orders.paymentStatus,
          registeredAt: orders.registeredAt,
        })
        .from(orders)
        .where(where)
        .orderBy(desc(orders.registeredAt), desc(orders.id))
        .limit(query.limit)
        .offset(query.offset);

      const ticketsByOrder = await this.ticketsByOrder(
        tx,
        organizationId,
        rows.map((r) => r.id),
      );
      const statusCounts = await this.statusCounts(tx, base);

      return {
        items: rows.map((r) => ({
          reference: r.reference,
          attendeeName: r.attendeeName,
          tickets: ticketsByOrder.get(r.id) ?? 0,
          amountSatang: r.amountSatang,
          paymentStatus: r.paymentStatus,
          registeredAt: r.registeredAt,
        })),
        total,
        statusCounts,
      };
    });
  }

  async attendees(
    organizationId: number,
    eventId: string,
    page: StatsPage,
  ): Promise<AttendeesResult> {
    return withTenant(this.db, organizationId, async (tx) => {
      const base = and(
        eq(orders.organizationId, organizationId),
        eq(orders.eventId, eventId),
        eq(orders.status, CONFIRMED),
        isNull(orders.deletedAt),
      );
      const [{ total }] = await tx
        .select({
          total: sql<number>`count(distinct ${orders.buyerEmail})::int`,
        })
        .from(orders)
        .where(base);
      const rows = await tx
        .select({
          email: orders.buyerEmail,
          name: sql<string>`max(${orders.buyerName})`,
          registrations: sql<number>`count(*)::int`,
          seats: sql<number>`coalesce(sum(${orders.seats}), 0)::int`,
        })
        .from(orders)
        .where(base)
        .groupBy(orders.buyerEmail)
        // email is the unique group key — the tiebreaker keeps paging stable when
        // two attendees share a display name (no duplicate/skipped rows).
        .orderBy(sql`max(${orders.buyerName})`, orders.buyerEmail)
        .limit(page.limit)
        .offset(page.offset);
      return {
        items: rows.map((r) => ({
          name: r.name,
          email: r.email,
          registrations: r.registrations,
          seats: r.seats,
        })),
        total,
      };
    });
  }

  /** Ticket quantity per order id (batched — avoids an N+1 over the page). */
  private async ticketsByOrder(
    tx: Tx,
    organizationId: number,
    orderIds: string[],
  ): Promise<Map<string, number>> {
    if (orderIds.length === 0) return new Map();
    const rows = await tx
      .select({
        orderId: orderItems.orderId,
        tickets: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int`,
      })
      .from(orderItems)
      .where(
        and(
          eq(orderItems.organizationId, organizationId),
          inArray(orderItems.orderId, orderIds),
        ),
      )
      .groupBy(orderItems.orderId);
    return new Map(rows.map((r) => [r.orderId, r.tickets]));
  }

  private async statusCounts(
    tx: Tx,
    base: ReturnType<typeof and>,
  ): Promise<RegistrationStatusCounts> {
    const rows = await tx
      .select({
        status: orders.paymentStatus,
        count: sql<number>`count(*)::int`,
      })
      .from(orders)
      .where(base)
      .groupBy(orders.paymentStatus);
    const counts: RegistrationStatusCounts = {
      all: 0,
      paid: 0,
      pending: 0,
      refunded: 0,
    };
    for (const row of rows) {
      counts.all += row.count;
      if (
        row.status === 'paid' ||
        row.status === 'pending' ||
        row.status === 'refunded'
      ) {
        counts[row.status] += row.count;
      }
    }
    return counts;
  }
}
