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

export interface PeriodChange {
  direction: 'up' | 'down' | 'flat';
  /** Null when there is no honest percentage to give — see `comparePeriod`. */
  percent: number | null;
  /** Null when flat, or when "better" is undefined for this metric. */
  improved: boolean | null;
}

/**
 * How a figure moved against the previous period (US-DASH-08).
 *
 * Two deliberate nulls. A percentage from a ZERO baseline is refused — 0 → 5 is
 * "new", not "+500%" — and that is exactly the "misleading value" the story
 * rules out in favour of a neutral empty state. And `improved` is null when
 * nothing moved, so a flat card renders neutral rather than green.
 *
 * `higherIsBetter` exists because not every card reads the same way: a falling
 * check-in rate is a warning, and the caller says which direction is good rather
 * than the UI guessing from the metric's name.
 */
export function comparePeriod(
  current: number,
  previous: number,
  options: { higherIsBetter?: boolean } = {},
): PeriodChange {
  const higherIsBetter = options.higherIsBetter ?? true;
  if (current === previous) {
    // Unchanged against a real baseline IS 0% — a fact worth showing. Unchanged
    // at zero is not: there is nothing to have changed from.
    return {
      direction: 'flat',
      percent: previous === 0 ? null : 0,
      improved: null,
    };
  }
  const direction = current > previous ? 'up' : 'down';
  const improved = (direction === 'up') === higherIsBetter;
  if (previous === 0) return { direction, percent: null, improved };
  const raw = ((current - previous) / previous) * 100;
  return { direction, percent: Math.round(raw * 10) / 10, improved };
}

/** Midnight Bangkok on the day of `instant`, as a UTC epoch millisecond. */
function startOfBangkokDay(instant: Date): number {
  const shifted = instant.getTime() + BANGKOK_OFFSET_MS;
  return Math.floor(shifted / DAY_MS) * DAY_MS - BANGKOK_OFFSET_MS;
}
