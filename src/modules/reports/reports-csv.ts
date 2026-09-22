import type { Cell, ColumnKind, Table } from '../../common/export/tabular';
import { BANGKOK_OFFSET_MS } from '../../common/time/bangkok';
import type { AttendanceReportView } from './attendance-report.service';
import type { DiscountsReportView } from './discounts-report.service';
import type { EventsReportView } from './events-report.service';
import type { IncomeReportView } from './income-report.service';
import type { RegistrationsReportView } from './registrations-report.service';
import {
  attendanceTable,
  discountsTable,
  eventsTable,
  incomeTable,
  registrationsTable,
  transactionsTable,
} from './report-tables';
import type { TransactionsReportView } from './transactions-report.service';

/**
 * A report's typed table, written the way a SPREADSHEET reads (US-RPT-11).
 *
 * The rows come from `report-tables`, shared with the workbook and the PDF, so
 * the three formats cannot disagree. What is decided here is only how each
 * value is spelled, and a CSV is machine-friendly throughout:
 *
 *   · Money is Baht with two decimals, not satang and not "฿1,070". A finance
 *     spreadsheet has to add these up.
 *   · Dates are ISO calendar days, not "Jul 18, 2026".
 *   · A figure that does not exist is an EMPTY CELL — never "—" and never 0.
 *     A dash is a word to a spreadsheet, and a zero is a lie.
 *
 * Deliberately no summary block and no timestamp: a header above the header
 * would stop a spreadsheet reading the file as a table at all. Those belong to
 * the workbook and the PDF, which are written for a person.
 *
 * Thai text and formula-injection are handled by `toCsv` itself.
 */

export interface CsvTable {
  headers: string[];
  rows: string[][];
}

const SATANG_PER_BAHT = 100;

/** Integer satang → a plain decimal a spreadsheet will treat as a number. */
function baht(satang: number): string {
  return (satang / SATANG_PER_BAHT).toFixed(2);
}

/** The Bangkok calendar day an instant falls on, as `YYYY-MM-DD`. */
function day(instant: Date): string {
  return new Date(instant.getTime() + BANGKOK_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}

/** One cell, spelled for a machine. */
function text(kind: ColumnKind, value: Cell): string {
  // Absent is absent, whatever the column holds.
  if (value === null) return '';
  if (kind === 'money') return baht(value as number);
  if (kind === 'day') return day(value as Date);
  // The full instant, for a ledger where the time of day is the point.
  if (kind === 'instant') return (value as Date).toISOString();
  return String(value);
}

export function toCsvTable(table: Table): CsvTable {
  return {
    headers: table.columns.map((column) => column.header),
    rows: table.rows.map((row) =>
      row.map((cell, index) => text(table.columns[index].kind, cell)),
    ),
  };
}

export const registrationsCsv = (view: RegistrationsReportView): CsvTable =>
  toCsvTable(registrationsTable(view));

export const attendanceCsv = (view: AttendanceReportView): CsvTable =>
  toCsvTable(attendanceTable(view));

export const incomeCsv = (view: IncomeReportView): CsvTable =>
  toCsvTable(incomeTable(view));

export const eventsCsv = (view: EventsReportView): CsvTable =>
  toCsvTable(eventsTable(view));

export const discountsCsv = (view: DiscountsReportView): CsvTable =>
  toCsvTable(discountsTable(view));

export const transactionsCsv = (view: TransactionsReportView): CsvTable =>
  toCsvTable(transactionsTable(view));
