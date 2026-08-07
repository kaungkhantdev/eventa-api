import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { checkIns, events, tickets } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import {
  type CheckInRate,
  CheckInInsightsPort,
} from '../dashboard/ports/operations-insights.port';

/** A ticket that entitles someone to walk in — the denominator of the rate. */
const ADMISSIBLE = ['issued', 'checked_in'] as const;
/** Only an event that has actually happened can have a turnout. */
const HELD_STATUSES = ['live', 'completed'] as const;

/**
 * Check-in's implementation of the Dashboard-owned attendance port
 * (US-DASH-08), so the check-in-rate card is computed without the dashboard
 * reading `check_ins`.
 *
 * The window is the EVENT's start, not the moment of admission: "what turnout
 * did last month's events get" is the question the card answers, and bucketing
 * by scan time would credit a late walk-in to the wrong month.
 *
 * Only events already held are counted. An event next week has sold tickets and
 * admitted nobody, and including it would drag the rate toward zero and make
 * the card read as a collapse in turnout — a misleading value, which US-DASH-08
 * rules out. Two raw counts are returned rather than a percentage so the caller
 * can tell "nobody was expected" apart from "nobody came".
 */
@Injectable()
export class CheckInInsightsAdapter extends CheckInInsightsPort {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {
    super();
  }

  async rateForPeriod(
    organizationId: number,
    period: { from: Date; to: Date },
  ): Promise<CheckInRate> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({
          expected: sql<number>`count(*)::int`,
          admitted: sql<number>`count(${checkIns.id})::int`,
        })
        .from(tickets)
        .innerJoin(events, eq(events.id, tickets.eventId))
        .leftJoin(checkIns, eq(checkIns.ticketId, tickets.id))
        .where(
          and(
            eq(tickets.organizationId, organizationId),
            inArray(tickets.status, [...ADMISSIBLE]),
            inArray(events.status, [...HELD_STATUSES]),
            gte(events.startAt, period.from),
            lt(events.startAt, period.to),
          ),
        );
      return row;
    });
  }
}
