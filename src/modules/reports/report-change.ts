import {
  comparePeriod,
  FLAT_CHANGE,
  type PeriodChange,
} from '../../common/analytics/period-change';

/**
 * How a report's tile moved against the previous equal period (US-RPT-01/02).
 *
 * Shared by every report that shows a headline figure, so "up 12%" means the
 * same arithmetic on the overview as on the income report. The window itself
 * comes from `resolveReportPeriod`, which already carries the previous period
 * beside the current one.
 */

/**
 * A null on EITHER side means no comparison is claimed.
 *
 * An unknown current figure has nothing to compare, and an unknown previous one
 * is not a zero to measure against — "up from 0%" invents a baseline that never
 * existed. Both render as a neutral "—".
 */
export function changeBetween(
  current: number | null,
  previous: number | null,
  options: { higherIsBetter?: boolean } = {},
): PeriodChange {
  if (current === null || previous === null) return FLAT_CHANGE;
  return comparePeriod(current, previous, options);
}

/**
 * The same comparison with no verdict attached.
 *
 * For a figure that moved without the move being good or bad — VAT is the
 * Revenue Department's money either way, and colouring it green would be
 * claiming something about it that is not true.
 */
export function undirectedChange(
  current: number | null,
  previous: number | null,
): PeriodChange {
  return { ...changeBetween(current, previous), improved: null };
}

/** Down is the improvement: refunds, fees, cancellations, no-shows. */
export const LOWER_IS_BETTER = { higherIsBetter: false } as const;
