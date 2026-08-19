import { vatInclusiveBreakdown } from '../../common/money/vat';
import type { TaxStatus } from './tax-periods.types';

/** Thai VAT returns (PP30) are due on the 15th of the following month. */
export const VAT_FILING_DAY = 15;
export const MONTHS_IN_YEAR = 12;

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** `6` → `Jun`. Months are 1-based, as they are written. */
export function monthLabel(month: number): string {
  return MONTH_LABELS[month - 1];
}

/** The filing deadline for a period, as `YYYY-MM-DD`. */
export function periodDueDate(year: number, month: number): string {
  const due = new Date(Date.UTC(year, month, VAT_FILING_DAY));
  return due.toISOString().slice(0, 10);
}

/** The first day of the month AFTER a period — when filing opens. */
function periodEnd(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
}

/**
 * Where a period stands today (US-FIN-11). Filing OPENS the day the month ends
 * and the 15th is merely the deadline — so a period sits at Due from the 1st,
 * and stays there until it is filed, however late that is.
 */
export function periodStatus(
  year: number,
  month: number,
  today: string,
  filed: boolean,
): TaxStatus {
  if (filed) return 'filed';
  return today >= periodEnd(year, month) ? 'due' : 'upcoming';
}

/** Filed after the deadline — recorded, never blocked (US-FIN-12). */
export function isLateFiling(
  filedOn: string,
  year: number,
  month: number,
): boolean {
  return filedOn > periodDueDate(year, month);
}

/**
 * Split a month's VAT-INCLUSIVE takings into the taxable base and the VAT on
 * it. Eventa charges gross, so the ledger's 7% is embedded in what was
 * collected; a month may be negative when refunds outweigh sales, and that is
 * carried rather than floored — the period genuinely owes less VAT.
 */
export function vatOnSales(
  grossSatang: number,
  rate: number,
): { salesSatang: number; vatSatang: number } {
  const { netSatang, vatSatang } = vatInclusiveBreakdown(grossSatang, rate);
  return { salesSatang: netSatang, vatSatang };
}
