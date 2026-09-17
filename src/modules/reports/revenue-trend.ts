import { BANGKOK_OFFSET_MS, DAY_MS } from '../../common/time/bangkok';

/**
 * The overview's revenue chart (US-RPT-01).
 *
 * The database groups payments into Bangkok calendar days — the one thing it is
 * better placed to do than this file. Everything after that is calendar
 * arithmetic on `YYYY-MM-DD` strings: which bucket a day belongs to, and which
 * buckets the window contains even though nothing was sold in them.
 *
 * Deliberately not SQL. Zero-filling with `generate_series` would put the rule
 * "a quiet day is ฿0, not a missing day" somewhere it cannot be tested without a
 * database, and it is the rule most likely to be got wrong.
 */

/** One Bangkok day's net revenue, as the income port reports it. */
export interface NetRevenueDay {
  /** `YYYY-MM-DD`. */
  day: string;
  netSatang: number;
}

/** One bar on the chart. `at` is the Bangkok day the bucket opens on. */
export interface TrendPoint {
  at: string;
  netSatang: number;
}

export const TREND_GRANULARITIES = ['day', 'week', 'month'] as const;
export type TrendGranularity = (typeof TREND_GRANULARITIES)[number];

/** Beyond these, a daily (then weekly) chart stops being readable. */
const MAX_DAILY_DAYS = 31;
const MAX_WEEKLY_DAYS = 120;

/**
 * How finely to plot a window of `days`.
 *
 * Chosen from the span rather than from the range the caller named, so a custom
 * `from`/`to` gets the same treatment as the equivalent preset — US-RPT-02 lets
 * any report be given arbitrary dates, and the chart should not only be legible
 * for the four buttons.
 */
export function granularityFor(days: number): TrendGranularity {
  if (days <= MAX_DAILY_DAYS) return 'day';
  if (days <= MAX_WEEKLY_DAYS) return 'week';
  return 'month';
}

/**
 * Daily takings, folded into the buckets the chart draws.
 *
 * The buckets come from the WINDOW, not from the data: a period with no revenue
 * still draws its full width at zero, which is the empty state US-RPT-01 asks
 * for ("a zero total and a neutral change instead of an error").
 */
export function bucketRevenue(
  days: NetRevenueDay[],
  period: { from: Date; to: Date },
  granularity: TrendGranularity,
): TrendPoint[] {
  const buckets = emptyBuckets(period, granularity);
  for (const { day, netSatang } of days) {
    const key = bucketOf(day, granularity);
    const running = buckets.get(key);
    if (running !== undefined) buckets.set(key, running + netSatang);
  }
  return [...buckets].map(([at, netSatang]) => ({ at, netSatang }));
}

/** Every bucket the window touches, in order, at zero. */
function emptyBuckets(
  period: { from: Date; to: Date },
  granularity: TrendGranularity,
): Map<string, number> {
  const buckets = new Map<string, number>();
  // Walked a day at a time rather than a bucket at a time: stepping by "month"
  // means knowing month lengths, while stepping by day never does — Bangkok has
  // no DST, so every day is exactly 24 hours.
  for (let at = period.from.getTime(); at < period.to.getTime(); at += DAY_MS) {
    buckets.set(bucketOf(dayStringOf(at), granularity), 0);
  }
  return buckets;
}

/** The day a bucket opens on, for the day inside it. */
function bucketOf(day: string, granularity: TrendGranularity): string {
  if (granularity === 'day') return day;
  if (granularity === 'month') return `${day.slice(0, 7)}-01`;
  return mondayOf(day);
}

/**
 * The Monday opening `day`'s week.
 *
 * ISO weeks, matching Postgres' own `date_trunc('week', …)`, so a weekly bucket
 * means the same thing whichever side of the port it is computed on.
 */
function mondayOf(day: string): string {
  const at = Date.parse(`${day}T00:00:00.000Z`);
  // getUTCDay is Sunday-first; ISO weeks are Monday-first.
  const sinceMonday = (new Date(at).getUTCDay() + 6) % 7;
  return new Date(at - sinceMonday * DAY_MS).toISOString().slice(0, 10);
}

/** The Bangkok calendar day of a UTC instant, as `YYYY-MM-DD`. */
function dayStringOf(instant: number): string {
  return new Date(instant + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
}
