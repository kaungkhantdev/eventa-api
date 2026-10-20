/** The tax-periods module's named constants. */

/** Thai VAT filing started long after this; a typo'd year is a bug, not data. */
export const MIN_YEAR = 2020;

export const MAX_YEAR = 2100;

export const MAX_WHT_SATANG = 1_000_000_000_000;

/** The Thai statutory rate, if a workspace row somehow carries none. */
export const DEFAULT_VAT_RATE = 0.07;

export const NOT_DUE =
  'Only a period that has ended can be filed — this one is still running.';

export const ALREADY_FILED = 'This period has already been filed.';

export const BAD_MONTH = 'Month must be between 1 and 12.';

export const NOTHING_TO_EXPORT =
  'There is nothing to export — no periods match these filters.';

export const EXPORT_HEADER = [
  'period',
  'year',
  'due_at',
  'taxable_sales_baht',
  'vat_collected_baht',
  'vat_remitted_baht',
  'vat_payable_baht',
  'withholding_baht',
  'status',
  'filed_at',
  'late',
];

/** Thai VAT returns (PP30) are due on the 15th of the following month. */
export const VAT_FILING_DAY = 15;

export const MONTHS_IN_YEAR = 12;

export const MONTH_LABELS = [
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
