import type {
  Column,
  ReportBody,
  SummaryFigure,
  Table,
} from '../../common/export/tabular';
import type { AttendanceReportView } from './attendance-report.service';
import type { DiscountsReportView } from './discounts-report.service';
import type { EventsReportView } from './events-report.service';
import type { IncomeReportView } from './income-report.service';
import type { RegistrationsReportView } from './registrations-report.service';
import type { TransactionsReportView } from './transactions-report.service';

/**
 * Each report as one typed table (US-RPT-11).
 *
 * Built from the SAME view the JSON endpoint returns, so "the file holds
 * exactly the rows I can see, for exactly the filters I set" is true by
 * construction rather than by two code paths being kept in step. And built
 * once for all three formats, so CSV, Excel and PDF cannot disagree either.
 *
 * Values stay in the domain's units — integer satang, a Date, a `null` for a
 * figure that was masked or never existed. Rendering is each format's job.
 *
 * The rows and the tiles are separate functions per report because they are
 * separately useful: a CSV is a table and nothing else, while a workbook and a
 * PDF carry the key figures above it.
 */

const SATANG_PER_BAHT = 100;

function columns(...pairs: [string, Column['kind']][]): Column[] {
  return pairs.map(([header, kind]) => ({ header, kind }));
}

function figure(
  label: string,
  kind: SummaryFigure['kind'],
  value: SummaryFigure['value'],
): SummaryFigure {
  return { label, kind, value };
}

/* ── registrations (US-RPT-08) ─────────────────────────────────────────── */

export function registrationsTable(view: RegistrationsReportView): Table {
  return {
    columns: columns(
      ['Event', 'text'],
      ['Starts', 'day'],
      ['Total', 'count'],
      ['Confirmed', 'count'],
      ['Pending', 'count'],
      ['Waitlisted', 'count'],
      ['Cancelled', 'count'],
      ['Rejected', 'count'],
    ),
    rows: view.rows.map((row) => [
      row.eventName,
      row.startAt,
      row.total,
      row.confirmed,
      row.pending,
      row.waitlisted,
      row.cancelled,
      row.rejected,
    ]),
  };
}

export function registrationsBody(view: RegistrationsReportView): ReportBody {
  return {
    title: 'Registrations',
    sheetName: 'Registrations',
    matched: view.matchedEvents,
    summary: [
      figure('Total registrations', 'count', view.totals.total),
      figure('Confirmed', 'count', view.totals.confirmed),
      figure('Pending', 'count', view.totals.pending),
      figure('Cancelled', 'count', view.totals.cancelled),
    ],
    table: registrationsTable(view),
  };
}

/* ── attendance (US-RPT-09) ────────────────────────────────────────────── */

export function attendanceTable(view: AttendanceReportView): Table {
  return {
    columns: columns(
      ['Event', 'text'],
      ['Starts', 'day'],
      ['Registered', 'count'],
      ['Checked in', 'count'],
      ['No-shows', 'count'],
      ['Attendance %', 'percent'],
      ['On-time %', 'percent'],
    ),
    rows: view.rows.map((row) => [
      row.eventName,
      row.startAt,
      row.registered,
      row.checkedIn,
      row.noShows,
      row.attendanceRate,
      row.onTimeRate,
    ]),
  };
}

export function attendanceBody(view: AttendanceReportView): ReportBody {
  return {
    title: 'Attendance',
    sheetName: 'Attendance',
    matched: view.matchedEvents,
    // Every rate stays null where the report has none: an event that has not
    // started has no attendance to report, and 0% would be a claim.
    summary: [
      figure('Checked in', 'count', view.totals.checkedIn),
      figure('Attendance rate', 'percent', view.totals.attendanceRate),
      figure('No-shows', 'count', view.totals.noShows),
      figure('On-time', 'percent', view.totals.onTimeRate),
    ],
    table: attendanceTable(view),
  };
}

/* ── income (US-RPT-05) ────────────────────────────────────────────────── */

export function incomeTable(view: IncomeReportView): Table {
  return {
    columns: columns(
      ['Event', 'text'],
      ['Starts', 'day'],
      ['Gross (THB)', 'money'],
      ['VAT (THB)', 'money'],
      ['Refunds (THB)', 'money'],
      ['Fees (THB)', 'money'],
      ['Net (THB)', 'money'],
      ['Settled (THB)', 'money'],
    ),
    rows: view.rows.map((row) => [
      row.eventName,
      row.startAt,
      row.grossSatang,
      row.vatSatang,
      row.refundsSatang,
      row.feesSatang,
      row.netSatang,
      row.settledSatang,
    ]),
  };
}

export function incomeBody(view: IncomeReportView): ReportBody {
  return {
    title: 'Income',
    sheetName: 'Income by event',
    matched: view.matchedEvents,
    summary: [
      figure('Gross revenue', 'money', view.totals.grossSatang),
      figure('Refunds', 'money', view.totals.refundsSatang),
      figure('Processing fees', 'money', view.totals.feesSatang),
      figure('Net revenue', 'money', view.totals.netSatang),
    ],
    table: incomeTable(view),
  };
}

/* ── event performance (US-RPT-04) ─────────────────────────────────────── */

export function eventsTable(view: EventsReportView): Table {
  return {
    columns: columns(
      ['Event', 'text'],
      ['Starts', 'day'],
      ['Venue', 'text'],
      ['City', 'text'],
      ['Stage', 'status'],
      ['Registrations', 'count'],
      ['Revenue (THB)', 'money'],
      ['Attendance %', 'percent'],
    ),
    rows: view.rows.map((row) => [
      row.eventName,
      row.startAt,
      row.venue ?? '',
      row.city ?? '',
      row.lifecycle,
      row.registrations,
      // Null for a reader without finance access. Never 0 — that would say the
      // event earned nothing, which is a different fact (US-RPT-12).
      row.revenueSatang,
      row.attendanceRate,
    ]),
  };
}

export function eventsBody(view: EventsReportView): ReportBody {
  return {
    title: 'Event performance',
    sheetName: 'Event performance',
    matched: view.matchedEvents,
    // The screen has no money tiles here — revenue is per row, and masked per
    // row for a reader without finance access.
    summary: [figure('Events', 'count', view.matchedEvents)],
    table: eventsTable(view),
  };
}

/* ── discount payback (US-RPT-10) ──────────────────────────────────────── */

/** The API finishes a percentage code's wording and leaves a fixed one in satang. */
function terms(row: { terms: string | null; fixedValueSatang: number | null }) {
  const off = ((row.fixedValueSatang ?? 0) / SATANG_PER_BAHT).toFixed(2);
  return row.terms ?? `${off} off`;
}

export function discountsTable(view: DiscountsReportView): Table {
  return {
    columns: columns(
      ['Code', 'text'],
      ['Terms', 'text'],
      ['Scope', 'text'],
      ['Standing', 'status'],
      ['Redemptions', 'count'],
      ['Discount given (THB)', 'money'],
      ['Orders influenced (THB)', 'money'],
      ['Return', 'ratio'],
    ),
    rows: view.rows.map((row) => [
      row.code,
      terms(row),
      row.scope,
      row.standing,
      row.redemptions,
      row.discountSatang,
      row.influencedSatang,
      row.returnRatio,
    ]),
  };
}

export function discountsBody(view: DiscountsReportView): ReportBody {
  return {
    title: 'Discount payback',
    sheetName: 'Discount payback',
    matched: view.matchedCodes,
    summary: [
      figure('Active codes', 'count', view.totals.activeCodes),
      figure('Redemptions', 'count', view.totals.redemptions),
      figure('Discount given', 'money', view.totals.discountSatang),
      figure('Revenue influenced', 'money', view.totals.influencedSatang),
    ],
    table: discountsTable(view),
  };
}

/* ── transaction ledger (US-RPT-06) ────────────────────────────────────── */

export function transactionsTable(view: TransactionsReportView): Table {
  return {
    columns: columns(
      ['Reference', 'text'],
      ['When', 'instant'],
      ['Type', 'text'],
      ['Payer', 'text'],
      ['Event', 'text'],
      ['Method', 'text'],
      ['Amount (THB)', 'money'],
      ['Status', 'status'],
    ),
    rows: view.rows.map((row) => [
      row.reference,
      row.at,
      row.kind,
      row.personName,
      row.eventName,
      row.method,
      // Signed HERE, unlike the screen and unlike the ledger it came from: a
      // column of figures has no colour to say which way the money went, and
      // signing it once means all three formats sign it the same way.
      row.kind === 'refund' ? -row.amountSatang : row.amountSatang,
      row.outcome,
    ]),
  };
}

export function transactionsBody(view: TransactionsReportView): ReportBody {
  return {
    title: 'Transactions',
    sheetName: 'Transactions',
    matched: view.matchedEntries,
    summary: [
      figure('Transactions', 'count', view.totals.entries),
      figure('Payments', 'money', view.totals.collectedSatang),
      figure('Refunds', 'count', view.totals.refunds),
      figure('Success rate', 'percent', view.totals.successRate),
    ],
    table: transactionsTable(view),
  };
}
