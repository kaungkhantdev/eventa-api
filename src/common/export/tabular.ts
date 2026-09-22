import { CSV_MIME } from '../csv/csv';

/**
 * One table, three files (US-RPT-11).
 *
 * The story asks for the same view as CSV, Excel or PDF. Three builders would
 * be three chances to disagree about what a report says — so a report is built
 * ONCE, as this typed table, and each format renders it.
 *
 * Which is why a cell keeps the domain's own units rather than a rendered
 * string: money is integer satang, an instant is a Date, and a figure that
 * does not exist is `null`. A spreadsheet needs the number to sum, a PDF needs
 * the text to print, and only the value itself can serve both.
 */

export const EXPORT_FORMATS = ['csv', 'xlsx', 'pdf'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_MIME: Record<ExportFormat, string> = {
  csv: CSV_MIME,
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

/**
 * What a column holds, which is what tells a format how to write it.
 *
 * `day` is a calendar day in Bangkok; `instant` is a moment where the time of
 * day is the point. `percent` is a whole number out of 100, as the API states
 * it. `ratio` is a multiple ("×4.0"). `status` is a raw domain token that only
 * a human-facing format capitalises.
 */
export type ColumnKind =
  | 'text'
  | 'day'
  | 'instant'
  | 'count'
  | 'money'
  | 'percent'
  | 'ratio'
  | 'status';

export interface Column {
  header: string;
  kind: ColumnKind;
}

/**
 * An amount that a sentence is built around: "฿200 off" for a reader,
 * "200.00 off" for a spreadsheet.
 *
 * The money stays satang here for the same reason it does in a money column —
 * a phrase composed upstream would carry ONE format's spelling into all three,
 * which is how a PDF ends up saying `200.00 off` beside `฿1,880`.
 */
export interface MoneyPhrase {
  readonly satang: number;
  /** What follows the amount, once the format has spelled it. */
  readonly suffix: string;
}

/**
 * Money is integer satang and may be negative (a refund). `null` means the
 * figure was masked from this reader, or does not exist — never zero.
 */
export type Cell = string | number | Date | MoneyPhrase | null;

export function isMoneyPhrase(value: Cell): value is MoneyPhrase {
  return typeof value === 'object' && value !== null && 'satang' in value;
}

export interface Table {
  columns: Column[];
  rows: Cell[][];
}

/** One of the tiles above the table on screen. */
export interface SummaryFigure {
  label: string;
  kind: ColumnKind;
  value: Cell;
}

/** One filter the reader had applied, as the file should say it back to them. */
export interface FilterLine {
  label: string;
  value: string;
}

export interface TabularDocument {
  title: string;
  /** Excel caps a sheet name at 31 characters. */
  sheetName: string;
  generatedAt: Date;
  filters: FilterLine[];
  summary: SummaryFigure[];
  table: Table;
  /**
   * How many rows the filter matched. More than `table.rows.length` means the
   * export hit its ceiling and the file is showing only the first of them.
   */
  matched: number;
}

/** What a report contributes; the service adds the filters and the clock. */
export type ReportBody = Pick<
  TabularDocument,
  'title' | 'sheetName' | 'summary' | 'table' | 'matched'
>;
