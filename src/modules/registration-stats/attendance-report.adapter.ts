import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, ilike, isNull, lt, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { events, tickets } from '../../db/schema';
import { withTenant, type Tx } from '../../db/tenant';
import {
  AttendanceReportPort,
  type AttendancePage,
  type AttendanceQuery,
  type AttendanceTotals,
  type AttendanceWindow,
} from '../reports/ports/attendance-report.port';

const LIVE_TICKET_STATUSES = ['issued', 'checked_in'] as const;

/**
 * RegistrationStats' implementation of the attendance report (US-RPT-09).
 *
 * Counts the TICKET read model rather than the check-in log: a ticket carries
 * both whether it was used and when, so registered and checked-in come from one
 * scan of one table and cannot disagree with each other. The log remains the
 * source of truth for who admitted whom.
 *
 * The window is on the EVENT's start, not on the check-in: "attendance for July"
 * means the events that ran in July, and putting the window on the check-in
 * would split one event across two reports.
 */
@Injectable()
export class AttendanceReportAdapter extends AttendanceReportPort {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {
    super();
  }

  async attendanceByEvent(
    organizationId: number,
    query: AttendanceQuery,
  ): Promise<AttendancePage> {
    return withTenant(this.db, organizationId, async (tx) => {
      const where = this.matching(organizationId, query);
      const registered = sql<number>`count(*)::int`;
      const checkedIn = sql<number>`count(*) FILTER (WHERE ${tickets.checkedInAt} IS NOT NULL)::int`;
      // On time means arriving before the doors were due to open on the event
      // itself, which is the only start time the organizer published.
      const onTime = sql<number>`count(*) FILTER (
        WHERE ${tickets.checkedInAt} IS NOT NULL AND ${tickets.checkedInAt} <= ${events.startAt}
      )::int`;
      const started = sql<boolean>`bool_or(${events.startAt} <= now())`;

      const rows = await tx
        .select({
          eventId: events.id,
          eventName: events.name,
          startAt: events.startAt,
          registered,
          checkedIn,
          onTime,
          started,
        })
        .from(tickets)
        .innerJoin(events, eq(events.id, tickets.eventId))
        .where(where)
        .groupBy(events.id, events.name, events.startAt)
        .orderBy(desc(checkedIn))
        .limit(query.limit)
        .offset((query.page - 1) * query.limit);

      const summary = await this.summarise(tx, where);
      return {
        rows: rows.map((row) => ({ ...row, started: row.started ?? false })),
        matchedEvents: summary.matchedEvents,
        totals: summary.totals,
      };
    });
  }

  /**
   * The same sums with no rows, for the overview's attendance tile and the
   * period it is compared against (US-RPT-01).
   */
  async totalsFor(
    organizationId: number,
    window: AttendanceWindow,
  ): Promise<AttendanceTotals> {
    return withTenant(this.db, organizationId, async (tx) => {
      const where = this.matching(organizationId, window);
      return (await this.summarise(tx, where)).totals;
    });
  }

  /**
   * Sums across everything the filter matched.
   *
   * The rate's numerator and denominator count STARTED events only — an event
   * still to come has registrations that have had no chance to be used, and
   * including them would report the workspace as missing people who are not yet
   * late. `checkedInAll` is a count rather than a rate, so it excludes nothing.
   */
  private async summarise(
    tx: Tx,
    where: ReturnType<AttendanceReportAdapter['matching']>,
  ): Promise<{ matchedEvents: number; totals: AttendanceTotals }> {
    const [summary] = await tx
      .select({
        registered: sql<number>`count(*) FILTER (WHERE ${events.startAt} <= now())::int`,
        checkedIn: sql<number>`count(*) FILTER (
          WHERE ${events.startAt} <= now() AND ${tickets.checkedInAt} IS NOT NULL
        )::int`,
        checkedInAll: sql<number>`count(*) FILTER (WHERE ${tickets.checkedInAt} IS NOT NULL)::int`,
        onTime: sql<number>`count(*) FILTER (
          WHERE ${tickets.checkedInAt} IS NOT NULL AND ${tickets.checkedInAt} <= ${events.startAt}
        )::int`,
        matchedEvents: sql<number>`count(distinct ${tickets.eventId})::int`,
      })
      .from(tickets)
      .innerJoin(events, eq(events.id, tickets.eventId))
      .where(where);

    return {
      matchedEvents: Number(summary?.matchedEvents ?? 0),
      totals: {
        registered: Number(summary?.registered ?? 0),
        checkedIn: Number(summary?.checkedIn ?? 0),
        checkedInAll: Number(summary?.checkedInAll ?? 0),
        onTime: Number(summary?.onTime ?? 0),
      },
    };
  }

  private matching(organizationId: number, query: AttendanceWindow) {
    return and(
      eq(tickets.organizationId, organizationId),
      // A void or refunded ticket was never going to be used; counting it would
      // report a no-show for somebody who withdrew.
      sql`${tickets.status} IN ('issued', 'checked_in')`,
      isNull(tickets.deletedAt),
      gte(events.startAt, query.from),
      lt(events.startAt, query.to),
      query.eventId ? eq(tickets.eventId, query.eventId) : undefined,
      query.search ? ilike(events.name, `%${query.search}%`) : undefined,
    );
  }
}

export { LIVE_TICKET_STATUSES };
