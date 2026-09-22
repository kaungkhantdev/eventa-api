import { Workbook, type Cell as SheetCell, type Worksheet } from 'exceljs';
import { BANGKOK_OFFSET_MS } from '../time/bangkok';
import { displayCell, generatedLine, REPORT_TIME_ZONE } from './display';
import type {
  Cell,
  ColumnKind,
  SummaryFigure,
  TabularDocument,
} from './tabular';

/**
 * The report as an Excel workbook (US-RPT-11).
 *
 * The story asks for "a summary of the key figures plus the detailed rows, with
 * money and percentages properly formatted". In a spreadsheet that means the
 * VALUE stays a number and the FORMAT carries the ฿ or the % — a cell of text
 * reading "฿1,070" is a figure finance cannot sum, and being able to sum it is
 * the whole reason they asked for Excel rather than the PDF.
 *
 * Two sheets, because the summary belongs above the rows for a reader but
 * beside them for a spreadsheet: a Summary sheet with the filters, the
 * timestamp and the tiles, and one sheet of rows that starts at its header.
 */

const SATANG_PER_BAHT = 100;

/** Excel refuses to open a workbook whose sheet name overruns this. */
const MAX_SHEET_NAME = 31;

/**
 * Baht with two decimals, negatives kept negative.
 *
 * Spelled out on both sides of the `;` so a refund reads `-฿1,250.00` rather
 * than Excel's default red parenthesised form, which no Thai finance team
 * expects.
 */
const MONEY_FORMAT = '"฿"#,##0.00;-"฿"#,##0.00';
const COUNT_FORMAT = '#,##0';
const RATIO_FORMAT = '"×"0.0';
const DAY_FORMAT = 'yyyy-mm-dd';
const INSTANT_FORMAT = 'yyyy-mm-dd hh:mm';

const WIDTH: Record<ColumnKind, number> = {
  text: 34,
  day: 13,
  instant: 18,
  count: 13,
  money: 16,
  percent: 13,
  ratio: 10,
  status: 14,
};

/**
 * A Date carrying the BANGKOK wall clock, as exceljs needs it.
 *
 * exceljs writes a Date as a UTC serial number, so an event starting 00:30 in
 * Bangkok would otherwise appear in the workbook on the previous day. Shifting
 * here is what makes the cell say what the screen says.
 */
function asBangkokClock(at: Date): Date {
  return new Date(at.getTime() + BANGKOK_OFFSET_MS);
}

/** Midnight of the Bangkok calendar day, so a date cell carries no time. */
function asBangkokDay(at: Date): Date {
  const shifted = asBangkokClock(at);
  return new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
    ),
  );
}

/**
 * Put one typed value into one cell.
 *
 * `null` leaves the cell EMPTY rather than writing 0: the API masks a figure
 * the reader may not see as null, and a zero in a revenue column would be a
 * claim that the event earned nothing (US-RPT-12).
 */
function write(cell: SheetCell, kind: ColumnKind, value: Cell): void {
  if (value === null) return;
  if (value instanceof Date) {
    cell.value = kind === 'day' ? asBangkokDay(value) : asBangkokClock(value);
    cell.numFmt = kind === 'day' ? DAY_FORMAT : INSTANT_FORMAT;
    return;
  }
  if (typeof value === 'number') {
    writeNumber(cell, kind, value);
    return;
  }
  // Always a text cell, never a formula: a buyer who names themselves
  // `=HYPERLINK(...)` must not have it run when an accountant opens the file.
  cell.value = kind === 'status' ? displayCell(kind, value) : value;
}

function writeNumber(cell: SheetCell, kind: ColumnKind, value: number): void {
  if (kind === 'money') {
    cell.value = value / SATANG_PER_BAHT;
    cell.numFmt = MONEY_FORMAT;
    return;
  }
  if (kind === 'percent') {
    // Excel's % format multiplies by 100, so the API's `80` is stored as 0.8.
    cell.value = value / 100;
    cell.numFmt = Number.isInteger(value) ? '0%' : '0.0%';
    return;
  }
  cell.value = value;
  if (kind === 'ratio') cell.numFmt = RATIO_FORMAT;
  if (kind === 'count') cell.numFmt = COUNT_FORMAT;
}

function summarySheet(workbook: Workbook, doc: TabularDocument): void {
  const sheet = workbook.addWorksheet('Summary');
  sheet.columns = [{ width: 26 }, { width: 34 }];
  sheet.addRow([doc.title]).font = { bold: true, size: 14 };
  sheet.addRow([generatedLine(doc.generatedAt)]);
  sheet.addRow([`Times are ${REPORT_TIME_ZONE} (UTC+7)`]);
  addFilters(sheet, doc);
  addFigures(sheet, doc.summary);
  addTruncationNote(sheet, doc);
}

function addFilters(sheet: Worksheet, doc: TabularDocument): void {
  if (doc.filters.length === 0) return;
  sheet.addRow([]);
  sheet.addRow(['Filters']).font = { bold: true };
  for (const filter of doc.filters) sheet.addRow([filter.label, filter.value]);
}

function addFigures(sheet: Worksheet, summary: SummaryFigure[]): void {
  if (summary.length === 0) return;
  sheet.addRow([]);
  sheet.addRow(['Key figures']).font = { bold: true };
  for (const figure of summary) {
    const row = sheet.addRow([figure.label]);
    write(row.getCell(2), figure.kind, figure.value);
  }
}

/**
 * Say so when the file holds only the first of the matching rows.
 *
 * A truncated export that does not admit it is worse than a refused one: the
 * reader would reconcile against a total that its own rows do not add up to.
 */
function addTruncationNote(sheet: Worksheet, doc: TabularDocument): void {
  const shown = doc.table.rows.length;
  if (doc.matched <= shown) return;
  sheet.addRow([]);
  sheet.addRow([
    `Showing the first ${shown.toLocaleString('en-US')} of ${doc.matched.toLocaleString('en-US')} matching rows.`,
  ]).font = { italic: true };
}

function rowsSheet(workbook: Workbook, doc: TabularDocument): void {
  const sheet = workbook.addWorksheet(doc.sheetName.slice(0, MAX_SHEET_NAME));
  const { columns, rows } = doc.table;
  sheet.columns = columns.map((column) => ({ width: WIDTH[column.kind] }));
  sheet.addRow(columns.map((column) => column.header)).font = { bold: true };
  // Frozen so the headers stay put over five thousand rows, and filterable so
  // the reader can narrow further without going back to the screen.
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  };
  for (const cells of rows) {
    const row = sheet.addRow([]);
    cells.forEach((cell, index) =>
      write(row.getCell(index + 1), columns[index].kind, cell),
    );
  }
}

export async function renderXlsx(doc: TabularDocument): Promise<Buffer> {
  const workbook = new Workbook();
  workbook.creator = 'Eventa';
  // The moment the figures were taken, which US-RPT-11 requires the file to
  // record — not the moment the bytes happened to be written.
  workbook.created = doc.generatedAt;
  workbook.modified = doc.generatedAt;
  summarySheet(workbook, doc);
  rowsSheet(workbook, doc);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
