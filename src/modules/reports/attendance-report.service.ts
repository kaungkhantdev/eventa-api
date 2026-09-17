import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/time/clock';
import {
  DEFAULT_REPORT_LIMIT,
  type ReportFilterQueryDto,
} from './dto/report-filter.query.dto';
import {
  AttendanceReportPort,
  type AttendanceCounts,
} from './ports/attendance-report.port';
import { resolveReportPeriod, type ReportPeriod } from './reports-period';

/**
 * Attendance and no-shows (US-RPT-09).
 *
 * The counts arrive raw; every rate is worked out here, because each one has a
 * case where the honest answer is "no rate" rather than zero, and those are
 * decisions about the domain rather than about SQL.
 */

export interface AttendanceRow extends AttendanceCounts {
  /** Null before the event has started — nobody has failed to arrive yet. */
  noShows: number | null;
  /** Percent, or null where there is no honest figure. */
  attendanceRate: number | null;
  /** Of those who came, the share who arrived before the start. */
  onTimeRate: number | null;
}

export interface AttendanceTotalsView {
  /** Every check-in in the window, whether or not its event has started. */
  checkedIn: number;
  noShows: number | null;
  attendanceRate: number | null;
  onTimeRate: number | null;
}

export interface AttendanceReportView {
  period: ReportPeriod;
  rows: AttendanceRow[];
  matchedEvents: number;
  totals: AttendanceTotalsView;
}

@Injectable()
export class AttendanceReportService {
  constructor(
    private readonly attendance: AttendanceReportPort,
    private readonly clock: Clock,
  ) {}

  async load(
    organizationId: number,
    filter: ReportFilterQueryDto,
  ): Promise<AttendanceReportView> {
    const period = resolveReportPeriod(filter, this.clock.now());

    const page = await this.attendance.attendanceByEvent(organizationId, {
      from: period.from,
      to: period.to,
      eventId: filter.eventId,
      search: filter.q,
      page: filter.page ?? 1,
      limit: filter.limit ?? DEFAULT_REPORT_LIMIT,
    });

    const { registered, checkedIn, checkedInAll, onTime } = page.totals;
    return {
      period,
      rows: page.rows.map(toRow),
      matchedEvents: page.matchedEvents,
      totals: {
        checkedIn: checkedInAll,
        noShows: registered === 0 ? null : registered - checkedIn,
        attendanceRate: rate(checkedIn, registered),
        onTimeRate: rate(onTime, checkedIn),
      },
    };
  }
}

/**
 * One event's row.
 *
 * An event that has not started carries no attendance figure at all: a zero
 * would read as "nobody came" when what happened is that nothing has happened.
 * A FINISHED event with no check-ins is a different fact, and it does report
 * zero — that is exactly the no-show problem the report exists to surface.
 */
function toRow(counts: AttendanceCounts): AttendanceRow {
  if (!counts.started) {
    return { ...counts, noShows: null, attendanceRate: null, onTimeRate: null };
  }
  return {
    ...counts,
    noShows:
      counts.registered === 0 ? null : counts.registered - counts.checkedIn,
    attendanceRate: rate(counts.checkedIn, counts.registered),
    // Measured against those who arrived, not those who registered: somebody
    // who never came is a no-show, not a late arrival.
    onTimeRate: rate(counts.onTime, counts.checkedIn),
  };
}

/** A whole-number percentage, or null when the denominator is nothing. */
function rate(part: number, whole: number): number | null {
  if (whole === 0) return null;
  return Math.round((part / whole) * 100);
}
