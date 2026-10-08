import { DomainException } from '../../common/errors/domain.exception';
import { BANGKOK_OFFSET_MS, DAY_MS } from '../../common/time/bangkok';

/**
 * The window a report covers, and the one it is compared against (US-RPT-02).
 *
 * Resolved once, here, for all eight reports. US-RPT-12 requires their totals to
 * agree, and two reports that each decide for themselves what "last 90 days"
 * means will disagree at the boundary with no way to say which is right.
 *
 * Distinct from the dashboard's own `periodFor`, which only offers three named
 * ranges ending at this instant. A report takes an arbitrary pair of calendar
 * days, has to refuse the ones that make no sense, and is capped.
 */

/** The ranges the overview's toggle offers (US-RPT-01). */
export const REPORT_RANGES = ['7d', '30d', '90d', 'year'] as const;
export type ReportRange = (typeof REPORT_RANGES)[number];

const RANGE_DAYS: Record<ReportRange, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  year: 365,
};

/** What the overview opens on, matching the dashboard's own default range. */
const DEFAULT_RANGE: ReportRange = 'year';

/**
 * Two years and the leap day between them.
 *
 * US-RPT-02 caps a span at 24 months. Expressed in days because every other
 * window in this codebase is day arithmetic, and because a calendar-month cap
 * would make the limit itself depend on which months were asked for.
 */
export const MAX_SPAN_DAYS = 731;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface ReportPeriodRequest {
  /** A Bangkok calendar day, `YYYY-MM-DD`. Wins over `range` when both are given. */
  from?: string;
  to?: string;
  range?: ReportRange;
}

export interface ReportPeriod {
  /** Bangkok midnight opening the window. */
  from: Date;
  /** Bangkok midnight CLOSING it — exclusive, so the end day is whole. */
  to: Date;
  /** The same length again, immediately before `from`; never overlapping it. */
  previousFrom: Date;
  previousTo: Date;
  days: number;
  /** The request asked for longer than the cap and was cut back to it. */
  trimmed: boolean;
}

export function resolveReportPeriod(
  request: ReportPeriodRequest,
  now: Date,
): ReportPeriod {
  const { from, to } = boundsOf(request, now);
  if (to.getTime() < from.getTime()) {
    throw DomainException.validation(
      'End date must be on or after the start date',
    );
  }
  return capped(from, to);
}

/** The window asked for, before the cap: explicit days, or a named range. */
function boundsOf(
  request: ReportPeriodRequest,
  now: Date,
): { from: Date; to: Date } {
  if (request.from !== undefined || request.to !== undefined) {
    // A half-open range is not a shorthand worth guessing at: the missing end
    // could reasonably mean today, the epoch, or the other end of the cap.
    return { from: startOfDay(request.from), to: endOfDay(request.to) };
  }
  const days = RANGE_DAYS[request.range ?? DEFAULT_RANGE];
  const to = new Date(startOfBangkokDay(now) + DAY_MS);
  return { from: new Date(to.getTime() - days * DAY_MS), to };
}

/**
 * The window, trimmed to the cap if it overruns.
 *
 * The recent end survives: somebody asking for four years of income wants the
 * two most recent, not the two oldest — and the far end is the one they are
 * least likely to notice moving.
 */
function capped(from: Date, to: Date): ReportPeriod {
  const asked = Math.round((to.getTime() - from.getTime()) / DAY_MS);
  const days = Math.min(asked, MAX_SPAN_DAYS);
  const start = new Date(to.getTime() - days * DAY_MS);
  return {
    from: start,
    to,
    previousFrom: new Date(start.getTime() - days * DAY_MS),
    previousTo: start,
    days,
    trimmed: asked > MAX_SPAN_DAYS,
  };
}

function startOfDay(day: string | undefined): Date {
  return new Date(parseBangkokDay(day));
}

/** Exclusive: the midnight that opens the day AFTER the one named. */
function endOfDay(day: string | undefined): Date {
  return new Date(parseBangkokDay(day) + DAY_MS);
}

/**
 * A `YYYY-MM-DD` Bangkok day as the UTC instant it begins.
 *
 * Refused rather than coerced. `new Date('last tuesday')` is `Invalid Date`, and
 * an invalid date flowing into a query produces an empty report that looks like
 * a real answer — worse than being told the input was unreadable.
 */
function parseBangkokDay(day: string | undefined): number {
  if (day === undefined || !DAY_PATTERN.test(day)) {
    throw DomainException.validation(
      'Dates must be calendar days, as YYYY-MM-DD',
    );
  }
  const parsed = Date.parse(`${day}T00:00:00.000+07:00`);
  if (Number.isNaN(parsed)) {
    throw DomainException.validation(
      'Dates must be calendar days, as YYYY-MM-DD',
    );
  }
  return parsed;
}

/** Midnight Bangkok on the day of `instant`, as a UTC epoch millisecond. */
function startOfBangkokDay(instant: Date): number {
  const shifted = instant.getTime() + BANGKOK_OFFSET_MS;
  return Math.floor(shifted / DAY_MS) * DAY_MS - BANGKOK_OFFSET_MS;
}
