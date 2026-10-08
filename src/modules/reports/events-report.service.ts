import { Injectable } from '@nestjs/common';
import { Permission } from '../../common/decorators/require-permissions.decorator';
import { Clock } from '../../common/time/clock';
import { PermissionsService } from '../access/permissions.service';
import type { AuthContext } from '../auth/auth.types';
import type { EventsReportQueryDto } from './dto/events-report.query.dto';
import { DEFAULT_REPORT_LIMIT } from './dto/report-filter.query.dto';
import {
  EventPerformancePort,
  type EventLifecycle,
  type EventPerformanceRow,
} from './ports/event-performance.port';
import { IncomeReportPort } from './ports/income-report.port';
import { resolveReportPeriod, type ReportPeriod } from './reports-period';

/**
 * Events ranked by registrations (US-RPT-04).
 *
 * The ranking, the counts and the lifecycle come from the port — they have to,
 * because the report filters and pages on them. What this service owns is what
 * those counts MEAN: an attendance rate that refuses to exist for an event that
 * has not happened, and a revenue figure that is withheld rather than zeroed for
 * a reader without finance access.
 *
 * Revenue is fetched for the page's events only. The ranking metric is
 * registrations, so the page is already decided before the money is asked for —
 * and asking about twenty events beats asking about a workspace's worth.
 */

export interface EventPerformanceView {
  eventId: string;
  eventName: string;
  startAt: Date;
  /** Where it happens: the venue, "Online", or null when nobody said. */
  venue: string | null;
  city: string | null;
  lifecycle: EventLifecycle;
  registrations: number;
  /** Net of VAT and refunds. Null when the reader may not see money. */
  revenueSatang: number | null;
  /** Percent, or null where there is no honest figure. */
  attendanceRate: number | null;
}

export interface EventsReportView {
  period: ReportPeriod;
  rows: EventPerformanceView[];
  matchedEvents: number;
}

const PERCENT = 100;
/** An event still to come has had no chance to be attended. */
const NOT_YET_HELD: EventLifecycle = 'upcoming';

@Injectable()
export class EventsReportService {
  constructor(
    private readonly events: EventPerformancePort,
    private readonly income: IncomeReportPort,
    private readonly permissions: PermissionsService,
    private readonly clock: Clock,
  ) {}

  async load(
    auth: AuthContext,
    filter: EventsReportQueryDto,
  ): Promise<EventsReportView> {
    const period = resolveReportPeriod(filter, this.clock.now());
    const org = auth.organizationId;

    const page = await this.events.rank(org, {
      from: period.from,
      to: period.to,
      eventId: filter.eventId,
      search: filter.q,
      lifecycle: filter.status,
      page: filter.page ?? 1,
      limit: filter.limit ?? DEFAULT_REPORT_LIMIT,
    });

    const revenue = await this.revenueFor(auth, page.rows);
    return {
      period,
      rows: page.rows.map((row) => toView(row, revenue)),
      matchedEvents: page.matchedEvents,
    };
  }

  /**
   * Net takings per event, or null throughout for a reader without `finView`.
   *
   * Checked before the fetch, so an unauthorized caller does not have the
   * figures read into the process and then hidden (US-RPT-12).
   */
  private async revenueFor(
    auth: AuthContext,
    rows: EventPerformanceRow[],
  ): Promise<Map<string, number> | null> {
    const granted = await this.permissions.getFor(
      auth.organizationId,
      auth.userId,
    );
    if (!granted.includes(Permission.finView)) return null;
    if (rows.length === 0) return new Map();

    const takings = await this.income.netByEvents(
      auth.organizationId,
      rows.map((row) => row.eventId),
    );
    return new Map(takings.map((one) => [one.eventId, one.netSatang]));
  }
}

function toView(
  row: EventPerformanceRow,
  revenue: Map<string, number> | null,
): EventPerformanceView {
  return {
    eventId: row.eventId,
    eventName: row.eventName,
    startAt: row.startAt,
    venue: venueOf(row),
    city: row.city,
    lifecycle: row.lifecycle,
    registrations: row.registrations,
    // A missing entry is a real ฿0 — that event took nothing. A null map is the
    // different fact that this reader may not be told.
    revenueSatang: revenue === null ? null : (revenue.get(row.eventId) ?? 0),
    attendanceRate: attendanceOf(row),
  };
}

/**
 * Where it happens.
 *
 * An online event has no venue and saying so is better than a blank; an
 * in-person event with no venue recorded is genuinely unknown, and "Online"
 * would be a claim nobody made.
 */
function venueOf(row: EventPerformanceRow): string | null {
  if (row.venueName) return row.venueName;
  return row.isOnline ? 'Online' : null;
}

/**
 * The share of ticket holders who arrived.
 *
 * Null before the event has started — the story asks for "—" rather than a
 * misleading zero — and null when nothing was issued, because a percentage of
 * nothing is undefined. A FINISHED event nobody came to really is 0%, and that
 * is the case the report exists to surface.
 */
function attendanceOf(row: EventPerformanceRow): number | null {
  if (row.lifecycle === NOT_YET_HELD) return null;
  if (row.ticketed === 0) return null;
  return Math.round((row.checkedIn / row.ticketed) * PERCENT);
}
