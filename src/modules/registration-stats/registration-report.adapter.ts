import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, ilike, isNull, lt, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { events, orderItems, orders, ticketTypes } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import {
  RegistrationReportPort,
  type RegistrationSplitPage,
  type RegistrationSplitQuery,
  type RegistrationTotals,
  type RegistrationWindow,
  type TicketShare,
} from '../reports/ports/registration-report.port';

/**
 * RegistrationStats' implementation of the Reports-owned split (US-RPT-08), so
 * the reporting module never reads the orders tables.
 *
 * A registration is a SEAT, not an order — the same definition the event
 * workspace already reports (`Σ seats of confirmed orders`). Counting orders
 * instead would under-report every group booking, and the two screens would
 * disagree about the same event.
 *
 * The window is on `registered_at`: this report answers "what came in during
 * this period", not "which events happen in it".
 */
@Injectable()
export class RegistrationReportAdapter extends RegistrationReportPort {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {
    super();
  }

  async splitByEvent(
    organizationId: number,
    query: RegistrationSplitQuery,
  ): Promise<RegistrationSplitPage> {
    return withTenant(this.db, organizationId, async (tx) => {
      const where = this.matching(organizationId, query);
      const columns = SEAT_COLUMNS;

      const rows = await tx
        .select({
          eventId: events.id,
          eventName: events.name,
          startAt: events.startAt,
          ...columns,
        })
        .from(orders)
        .innerJoin(events, eq(events.id, orders.eventId))
        .where(where)
        .groupBy(events.id, events.name, events.startAt)
        // Best-first, which is how every report in this epic ranks.
        .orderBy(desc(columns.total))
        .limit(query.limit)
        .offset((query.page - 1) * query.limit);

      // Summed over the whole filter, and counted over events rather than rows,
      // because the tiles must not change as the reader pages through.
      const [summary] = await tx
        .select({
          ...columns,
          matchedEvents: sql<number>`count(distinct ${orders.eventId})::int`,
        })
        .from(orders)
        .innerJoin(events, eq(events.id, orders.eventId))
        .where(where);

      return {
        rows,
        matchedEvents: summary?.matchedEvents ?? 0,
        totals: toTotals(summary),
      };
    });
  }

  /**
   * The same split with no rows, for the overview's registrations tile and the
   * period it is compared against (US-RPT-01). Same predicate, so the overview
   * and this report cannot disagree about one window.
   */
  async totalsFor(
    organizationId: number,
    window: RegistrationWindow,
  ): Promise<RegistrationTotals> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [summary] = await tx
        .select(SEAT_COLUMNS)
        .from(orders)
        .innerJoin(events, eq(events.id, orders.eventId))
        .where(this.matching(organizationId, window));
      return toTotals(summary);
    });
  }

  /**
   * The split by ticket type (US-RPT-03).
   *
   * Sums SEATS rather than counting order lines, so the donut's centre is the
   * same registrations figure the tile above it shows. Confirmed orders only,
   * for the same reason every other report counts them.
   */
  async ticketMix(
    organizationId: number,
    window: RegistrationWindow,
  ): Promise<TicketShare[]> {
    return withTenant(this.db, organizationId, async (tx) => {
      const seats = sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int`;
      return tx
        .select({ ticketTypeName: ticketTypes.name, seats })
        .from(orders)
        .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
        .innerJoin(ticketTypes, eq(ticketTypes.id, orderItems.ticketTypeId))
        .innerJoin(events, eq(events.id, orders.eventId))
        .where(
          and(
            this.matching(organizationId, window),
            eq(orders.status, 'confirmed'),
          ),
        )
        .groupBy(ticketTypes.name)
        .orderBy(desc(seats));
    });
  }

  /** One predicate, shared by the page and its totals so they cannot diverge. */
  private matching(organizationId: number, query: RegistrationWindow) {
    return and(
      eq(orders.organizationId, organizationId),
      gte(orders.registeredAt, query.from),
      lt(orders.registeredAt, query.to),
      isNull(orders.deletedAt),
      query.eventId ? eq(orders.eventId, query.eventId) : undefined,
      query.search ? ilike(events.name, `%${query.search}%`) : undefined,
    );
  }
}

/** Seats booked in one order state, as an integer rather than a bigint string. */
function seatsIn(status: string) {
  return sql<number>`coalesce(sum(case when ${orders.status} = ${status} then ${orders.seats} else 0 end), 0)::int`;
}

/** Declared once so the rows, the page totals and the overview all count alike. */
const SEAT_COLUMNS = {
  confirmed: seatsIn('confirmed'),
  pending: seatsIn('pending'),
  waitlisted: seatsIn('waitlisted'),
  cancelled: seatsIn('cancelled'),
  rejected: seatsIn('rejected'),
  total: sql<number>`coalesce(sum(${orders.seats}), 0)::int`,
};

/** A summary row, or zeroes when the filter matched nothing at all. */
function toTotals(
  summary: Partial<RegistrationTotals> | undefined,
): RegistrationTotals {
  return {
    confirmed: summary?.confirmed ?? 0,
    pending: summary?.pending ?? 0,
    waitlisted: summary?.waitlisted ?? 0,
    cancelled: summary?.cancelled ?? 0,
    rejected: summary?.rejected ?? 0,
    total: summary?.total ?? 0,
  };
}
