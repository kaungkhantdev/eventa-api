/**
 * What Reports needs to know about who turned up (US-RPT-09), without reading
 * the tickets or check-in tables.
 *
 * Raw counts only. The rates, and the rule about which events may carry one,
 * are computed by the report service — they are domain decisions with defined
 * edge cases, and they belong somewhere they can be tested without a database.
 */

/** One event's door numbers for the window. */
export interface AttendanceCounts {
  eventId: string;
  eventName: string;
  startAt: Date;
  /** Live tickets issued for the event: the denominator. */
  registered: number;
  checkedIn: number;
  /** Of those checked in, how many arrived before the event began. */
  onTime: number;
  /** Whether the event has started; an unstarted one has no rate to report. */
  started: boolean;
}

/**
 * Sums across the whole filter.
 *
 * `registered` and `checkedIn` count only events that have STARTED, because
 * they are the denominator and numerator of the overall rate and US-RPT-09
 * excludes unstarted events from it. `checkedInAll` is every check-in in the
 * window, which is a count rather than a rate and so excludes nothing.
 */
export interface AttendanceTotals {
  registered: number;
  checkedIn: number;
  checkedInAll: number;
  onTime: number;
}

/** The slice being asked about, before paging. Windowed on the event's start. */
export interface AttendanceWindow {
  from: Date;
  /** Exclusive. */
  to: Date;
  eventId?: string;
  search?: string;
}

export interface AttendanceQuery extends AttendanceWindow {
  page: number;
  limit: number;
}

export interface AttendancePage {
  rows: AttendanceCounts[];
  matchedEvents: number;
  totals: AttendanceTotals;
}

export abstract class AttendanceReportPort {
  abstract attendanceByEvent(
    organizationId: number,
    query: AttendanceQuery,
  ): Promise<AttendancePage>;

  /**
   * The same sums with no rows, for the overview's attendance tile and the
   * previous period it is compared against (US-RPT-01).
   */
  abstract totalsFor(
    organizationId: number,
    window: AttendanceWindow,
  ): Promise<AttendanceTotals>;
}
