/**
 * How a figure moved against the previous period.
 *
 * Shared by the dashboard (US-DASH-08) and the reports overview (US-RPT-01),
 * which state the same requirement in the same words: a change, a direction, and
 * a colour that follows what is GOOD for the metric rather than the sign of the
 * number. Two copies of this rule would eventually disagree about a card that
 * appears on both screens, and the reader would have no way to tell which was
 * right.
 */

export interface PeriodChange {
  direction: 'up' | 'down' | 'flat';
  /** Null when there is no honest percentage to give — see `comparePeriod`. */
  percent: number | null;
  /** Null when flat, or when "better" is undefined for this metric. */
  improved: boolean | null;
}

/**
 * Two deliberate nulls. A percentage from a ZERO baseline is refused — 0 → 5 is
 * "new", not "+500%" — and that is exactly the "misleading value" both stories
 * rule out in favour of a neutral empty state. And `improved` is null when
 * nothing moved, so a flat card renders neutral rather than green.
 *
 * `higherIsBetter` exists because not every card reads the same way: a falling
 * check-in rate is a warning and a falling REFUND rate is a win, so the caller
 * says which direction is good rather than the UI guessing from the metric's
 * name.
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

/** Nothing to compare against: shown, but never coloured. */
export const FLAT_CHANGE: PeriodChange = {
  direction: 'flat',
  percent: null,
  improved: null,
};
