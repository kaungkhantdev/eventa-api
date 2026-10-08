import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, ilike, isNull, lt, ne, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { events } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import {
  EventPerformancePort,
  type EventLifecycle,
  type EventPerformancePage,
  type EventPerformanceQuery,
} from '../reports/ports/event-performance.port';

/**
 * RegistrationStats' implementation of the event-performance ranking
 * (US-RPT-04), so Reports never reads events, orders or tickets itself.
 *
 * Driven FROM `events` with correlated subqueries rather than joins. Every other
 * per-event report starts at a fact table, which is right for "income by event"
 * and wrong here: "all events ranked by registrations" has to list the event
 * nobody signed up for, last, rather than omit it. A join would also multiply
 * the seat sum by the ticket count, since an event has many of both.
 */

/**
 * Where an event is in its life, from the clock.
 *
 * NOT `events.status`: that column is written on create, on publish and on
 * cancel, and nothing in the API or the worker ever advances it afterwards — so
 * last year's conference still says "upcoming". Reading it would badge every
 * past event wrongly.
 *
 * `cancelled` wins over the clock, because it was written deliberately and an
 * event that was called off did not quietly "complete". An event with no end
 * time is treated as running for a day, which is the only assumption available
 * when the organizer did not say.
 *
 * In SQL rather than in the service because the report FILTERS and PAGES on it;
 * deriving it in JavaScript would mean paging a set the database cannot count.
 * Every branch is covered by the e2e.
 */
const LIFECYCLE = sql<EventLifecycle>`CASE
  WHEN events.status = 'cancelled' THEN 'cancelled'
  WHEN now() < events.start_at THEN 'upcoming'
  WHEN now() < coalesce(events.end_at, events.start_at + interval '1 day') THEN 'live'
  ELSE 'completed'
END`;

/**
 * Written as literal SQL rather than with `${events.status}` interpolation, for
 * the reason spelled out on the subqueries below.
 */

@Injectable()
export class EventPerformanceAdapter extends EventPerformancePort {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {
    super();
  }

  async rank(
    organizationId: number,
    query: EventPerformanceQuery,
  ): Promise<EventPerformancePage> {
    return withTenant(this.db, organizationId, async (tx) => {
      const where = this.matching(organizationId, query);
      const registrations = this.seatsConfirmed();

      const rows = await tx
        .select({
          eventId: events.id,
          eventName: events.name,
          startAt: events.startAt,
          venueName: events.venueName,
          city: events.city,
          isOnline: events.isOnline,
          lifecycle: LIFECYCLE,
          registrations,
          ticketed: this.ticketsWhere('true'),
          checkedIn: this.ticketsWhere('t.checked_in_at IS NOT NULL'),
        })
        .from(events)
        .where(where)
        .orderBy(desc(registrations), desc(events.startAt))
        .limit(query.limit)
        .offset((query.page - 1) * query.limit);

      const [summary] = await tx
        .select({ matched: sql<number>`count(*)::int` })
        .from(events)
        .where(where);

      return {
        rows: rows.map((row) => ({
          ...row,
          isOnline: row.isOnline ?? false,
          registrations: Number(row.registrations),
          ticketed: Number(row.ticketed),
          checkedIn: Number(row.checkedIn),
        })),
        matchedEvents: Number(summary?.matched ?? 0),
      };
    });
  }

  private matching(organizationId: number, query: EventPerformanceQuery) {
    return and(
      eq(events.organizationId, organizationId),
      // A draft was never published, so it has no performance to rank. Cancelled
      // events stay: what they took and refunded is real history.
      ne(events.status, 'draft'),
      isNull(events.deletedAt),
      gte(events.startAt, query.from),
      lt(events.startAt, query.to),
      query.eventId ? eq(events.id, query.eventId) : undefined,
      query.search ? ilike(events.name, `%${query.search}%`) : undefined,
      query.lifecycle ? eq(LIFECYCLE, query.lifecycle) : undefined,
    );
  }

  /**
   * Confirmed seats for this event — the same definition every report uses.
   *
   * The column references are LITERAL SQL, not `${orders.eventId}`. Drizzle
   * strips the table qualifier off an interpolated column inside a select-list
   * subquery: `${orders.eventId} = ${events.id}` renders as
   * `"event_id" = "id"`, and inside `FROM orders` the bare `"id"` binds to
   * `orders.id` — so the correlation compares an order's event to its own id,
   * matches nothing, and returns a confident 0 for every event. It is wrong
   * SILENTLY, which is worse than an error, and the same fragment renders
   * correctly in ORDER BY, so the ranking looks plausible while every count is
   * zero. Explicit aliases cost the compile-time link to the schema and buy
   * SQL that means what it says.
   */
  private seatsConfirmed() {
    return sql<number>`coalesce((
      SELECT sum(o.seats)
      FROM orders o
      WHERE o.event_id = events.id
        AND o.status = 'confirmed'
        AND o.deleted_at IS NULL
    ), 0)::int`;
  }

  /** Live tickets for this event, optionally narrowed further. */
  private ticketsWhere(extra: string) {
    return sql<number>`(
      SELECT count(*)
      FROM tickets t
      WHERE t.event_id = events.id
        AND t.status IN ('issued', 'checked_in')
        AND t.deleted_at IS NULL
        AND ${sql.raw(extra)}
    )::int`;
  }
}
