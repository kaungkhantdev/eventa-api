import { BANGKOK_OFFSET_MS } from '../../common/time/bangkok';
import type { AttendanceReportView } from './attendance-report.service';
import type { DiscountsReportView } from './discounts-report.service';
import type { EventsReportView } from './events-report.service';
import type { IncomeReportView } from './income-report.service';
import type { RegistrationsReportView } from './registrations-report.service';
import type { TransactionsReportView } from './transactions-report.service';

/**
 * A report, as a file (US-RPT-11).
 *
 * Built from the SAME view the JSON endpoint returns, so "the export contains
 * exactly the rows I can see, for exactly the filters I set" holds by
 * construction rather than by two code paths being kept in step.
 *
 * Machine-friendly throughout, which is what the story asks a CSV to be:
 *
 *   · Money is Baht with two decimals, not satang and not "฿1,070". A finance
 *     spreadsheet has to add these up.
 *   · Dates are ISO calendar days, not "Jul 18, 2026".
 *   · A figure that does not exist is an EMPTY CELL — never "—" and never 0.
 *     A dash is a word to a spreadsheet, and a zero is a lie.
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

/** Money the caller may not see, or that does not exist, is simply absent. */
function maybeBaht(satang: number | null): string {
  return satang === null ? '' : baht(satang);
}

function maybeNumber(value: number | null): string {
  return value === null ? '' : String(value);
}

/** The Bangkok calendar day an instant falls on, as `YYYY-MM-DD`. */
function day(instant: Date): string {
  return new Date(instant.getTime() + BANGKOK_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}

/** The full instant, for a ledger where the time of day is the point. */
function instant(at: Date): string {
  return at.toISOString();
}

export function registrationsCsv(view: RegistrationsReportView): CsvTable {
  return {
    headers: [
      'Event',
      'Starts',
      'Total',
      'Confirmed',
      'Pending',
      'Waitlisted',
      'Cancelled',
      'Rejected',
    ],
    rows: view.rows.map((row) => [
      row.eventName,
      day(row.startAt),
      String(row.total),
      String(row.confirmed),
      String(row.pending),
      String(row.waitlisted),
      String(row.cancelled),
      String(row.rejected),
    ]),
  };
}

export function attendanceCsv(view: AttendanceReportView): CsvTable {
  return {
    headers: [
      'Event',
      'Starts',
      'Registered',
      'Checked in',
      'No-shows',
      'Attendance %',
      'On-time %',
    ],
    rows: view.rows.map((row) => [
      row.eventName,
      day(row.startAt),
      String(row.registered),
      String(row.checkedIn),
      maybeNumber(row.noShows),
      maybeNumber(row.attendanceRate),
      maybeNumber(row.onTimeRate),
    ]),
  };
}

export function incomeCsv(view: IncomeReportView): CsvTable {
  return {
    headers: [
      'Event',
      'Starts',
      'Gross (THB)',
      'VAT (THB)',
      'Refunds (THB)',
      'Fees (THB)',
      'Net (THB)',
      'Settled (THB)',
    ],
    rows: view.rows.map((row) => [
      row.eventName,
      day(row.startAt),
      baht(row.grossSatang),
      baht(row.vatSatang),
      baht(row.refundsSatang),
      baht(row.feesSatang),
      baht(row.netSatang),
      baht(row.settledSatang),
    ]),
  };
}

export function eventsCsv(view: EventsReportView): CsvTable {
  return {
    headers: [
      'Event',
      'Starts',
      'Venue',
      'City',
      'Stage',
      'Registrations',
      'Revenue (THB)',
      'Attendance %',
    ],
    rows: view.rows.map((row) => [
      row.eventName,
      day(row.startAt),
      row.venue ?? '',
      row.city ?? '',
      row.lifecycle,
      String(row.registrations),
      maybeBaht(row.revenueSatang),
      maybeNumber(row.attendanceRate),
    ]),
  };
}

export function discountsCsv(view: DiscountsReportView): CsvTable {
  return {
    headers: [
      'Code',
      'Terms',
      'Scope',
      'Standing',
      'Redemptions',
      'Discount given (THB)',
      'Orders influenced (THB)',
      'Return',
    ],
    rows: view.rows.map((row) => [
      row.code,
      // The API finishes a percentage code's wording and leaves a fixed one in
      // satang; the file needs both as something readable.
      row.terms ?? `${baht(row.fixedValueSatang ?? 0)} off`,
      row.scope,
      row.standing,
      String(row.redemptions),
      baht(row.discountSatang),
      baht(row.influencedSatang),
      maybeNumber(row.returnRatio),
    ]),
  };
}

export function transactionsCsv(view: TransactionsReportView): CsvTable {
  return {
    headers: [
      'Reference',
      'When',
      'Type',
      'Payer',
      'Event',
      'Method',
      'Amount (THB)',
      'Status',
    ],
    rows: view.rows.map((row) => [
      row.reference,
      instant(row.at),
      row.kind,
      row.personName,
      row.eventName,
      row.method,
      // Signed HERE, unlike the screen: a spreadsheet summing this column must
      // see a refund as money leaving, and it has no colour to tell it so.
      row.kind === 'refund'
        ? `-${baht(row.amountSatang)}`
        : baht(row.amountSatang),
      row.outcome,
    ]),
  };
}
