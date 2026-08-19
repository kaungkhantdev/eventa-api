import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { events, ticketTypes } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import {
  type EventReach,
  EventInsightsPort,
} from '../dashboard/ports/operations-insights.port';
import { Clock } from '../../common/time/clock';

const LIVE_STATUSES = ['planned', 'upcoming', 'live'] as const;
/** An allocation of 0 means unlimited — mirrors `TicketingPolicy`. */
const UNLIMITED = 0;
const PERCENT = 100;

/**
 * Events' implementation of the Dashboard-owned reach port (US-DASH-08), so
 * the KPI cards read "upcoming events" and "capacity filled" without the
 * dashboard touching `events`.
 *
 * Capacity is measured across live events' ticket tiers, and only those with a
 * real allocation: an unlimited tier has no denominator, and including it would
 * drag every organizer's capacity figure toward zero for no reason. With no
 * bounded tiers at all the answer is `null` — not 0% — which is the neutral
 * empty state the story asks for rather than a figure that reads as a failure.
 */
@Injectable()
export class EventInsightsAdapter extends EventInsightsPort {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly clock: Clock,
  ) {
    super();
  }

  async reach(organizationId: number): Promise<EventReach> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [upcoming] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(events)
        .where(
          and(
            eq(events.organizationId, organizationId),
            inArray(events.status, [...LIVE_STATUSES]),
            isNull(events.deletedAt),
            gt(events.startAt, this.clock.now()),
          ),
        );
      const [capacity] = await tx
        .select({
          sold: sql<number>`coalesce(sum(${ticketTypes.sold}), 0)::int`,
          offered: sql<number>`coalesce(sum(${ticketTypes.total}), 0)::int`,
        })
        .from(ticketTypes)
        .innerJoin(events, eq(events.id, ticketTypes.eventId))
        .where(
          and(
            eq(ticketTypes.organizationId, organizationId),
            inArray(events.status, [...LIVE_STATUSES]),
            isNull(events.deletedAt),
            gt(ticketTypes.total, UNLIMITED),
          ),
        );
      return {
        upcoming: upcoming.count,
        capacityFilledPercent:
          capacity.offered === 0
            ? null
            : round1((capacity.sold / capacity.offered) * PERCENT),
      };
    });
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;
