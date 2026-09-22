import { formatBaht } from '../money/baht';
import { isMoneyPhrase, type Cell, type ColumnKind } from './tabular';

/**
 * A typed cell as a PERSON reads it (US-RPT-11).
 *
 * The counterpart of `toCsvTable`: the same table, spelled for the PDF and for
 * the workbook's summary lines. Where a spreadsheet wants `1070.00` and an
 * empty cell, a reader wants `฿1,070` and a dash.
 *
 * All of it in Asia/Bangkok, which is the only timezone this product states
 * figures in — never the server's.
 */

/** The timezone every Eventa screen and file states its times in. */
export const REPORT_TIME_ZONE = 'Asia/Bangkok';

/** Grouping and month names, not a translation — ฿ is written the same in TH. */
const DISPLAY_LOCALE = 'en-US';

/**
 * What a figure that does not exist looks like.
 *
 * An em dash, never `฿0` and never `0%`: the API masks a figure the reader may
 * not see as null, and "you may not see this" is not "it was zero".
 */
export const MASKED = '—';

const DAY_FORMAT = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
  timeZone: REPORT_TIME_ZONE,
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

// `h23` rather than the locale's own cycle, so midnight reads 00:30 and not
// the 24:30 an `h24` cycle would print.
const INSTANT_FORMAT = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
  timeZone: REPORT_TIME_ZONE,
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** The kinds whose cells are numbers. The rest are text or a Date. */
type NumericKind = 'money' | 'percent' | 'ratio' | 'count';

const NUMERIC: Record<NumericKind, (value: number) => string> = {
  // `฿1,070`, and a refund as `-฿1,250` — the sign in front of the symbol,
  // which is where a reader expects it and where `formatBaht` cannot put it.
  money: (value) => (value < 0 ? `-${formatBaht(-value)}` : formatBaht(value)),
  // A whole number out of 100, keeping a fraction only where there is one.
  percent: (value) =>
    `${value.toLocaleString(DISPLAY_LOCALE, { maximumFractionDigits: 1 })}%`,
  // A multiple, written as the screen writes it.
  ratio: (value) =>
    `×${value.toLocaleString(DISPLAY_LOCALE, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })}`,
  count: (value) => value.toLocaleString(DISPLAY_LOCALE),
};

const isNumeric = (kind: ColumnKind): kind is NumericKind => kind in NUMERIC;

export function displayCell(kind: ColumnKind, value: Cell): string {
  if (value === null) return MASKED;
  // The amount in the product's own ฿, and only then the phrase around it.
  if (isMoneyPhrase(value)) {
    return `${NUMERIC.money(value.satang)} ${value.suffix}`;
  }
  if (value instanceof Date) {
    return kind === 'day'
      ? DAY_FORMAT.format(value)
      : INSTANT_FORMAT.format(value);
  }
  if (typeof value === 'number') {
    return isNumeric(kind) ? NUMERIC[kind](value) : String(value);
  }
  // A raw domain token is capitalised for a human-facing file; free text,
  // Thai included, is left exactly as the organizer wrote it.
  return kind === 'status'
    ? value.charAt(0).toUpperCase() + value.slice(1)
    : value;
}

/**
 * When the figures were taken (US-RPT-11).
 *
 * The timezone is named rather than assumed: a file that travels to a
 * stakeholder abroad has to say which midnight its numbers were counted to.
 */
export function generatedLine(at: Date): string {
  return `Generated ${INSTANT_FORMAT.format(at)} (${REPORT_TIME_ZONE})`;
}
