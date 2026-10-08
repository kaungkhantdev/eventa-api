import { BANGKOK_OFFSET_MS, DAY_MS } from '../../common/time/bangkok';

/** The ranges the revenue toggle offers (US-DASH-09). Year is the default. */
export type DashboardRange = 'week' | 'month' | 'year';

const RANGE_DAYS: Record<DashboardRange, number> = {
  week: 7,
  month: 30,
  year: 365,
};

export interface Period {
  from: Date;
  to: Date;
  /** The same length again, immediately before `from` — never overlapping it. */
  previousFrom: Date;
  previousTo: Date;
  days: number;
}

/**
 * The window a dashboard figure covers, and the one it is compared against.
 *
 * The window STARTS on a Bangkok day boundary and ends at this instant. Starting
 * mid-afternoon would quietly drop most of the first day from "this week" while
 * still calling it seven days — and would make the same page disagree with
 * itself as the afternoon wore on.
 *
 * The previous period is the same number of days ending exactly where this one
 * begins: adjacent, never overlapping, so nothing is counted in both halves of
 * its own comparison.
 */
export function periodFor(range: DashboardRange, now: Date): Period {
  const days = RANGE_DAYS[range];
  const from = new Date(startOfBangkokDay(now) - (days - 1) * DAY_MS);
  const previousFrom = new Date(from.getTime() - days * DAY_MS);
  return { from, to: now, previousFrom, previousTo: from, days };
}

/**
 * The comparison itself lives in `common/analytics`: the reports overview
 * (US-RPT-01) states the same rule as US-DASH-08, and the two screens must not
 * be able to disagree about how a figure moved. Re-exported so the dashboard's
 * own callers still read it from here.
 */
export {
  comparePeriod,
  FLAT_CHANGE,
  type PeriodChange,
} from '../../common/analytics/period-change';

/** Midnight Bangkok on the day of `instant`, as a UTC epoch millisecond. */
function startOfBangkokDay(instant: Date): number {
  const shifted = instant.getTime() + BANGKOK_OFFSET_MS;
  return Math.floor(shifted / DAY_MS) * DAY_MS - BANGKOK_OFFSET_MS;
}
