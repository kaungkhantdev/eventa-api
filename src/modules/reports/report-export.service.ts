import { Injectable } from '@nestjs/common';
import { toCsv } from '../../common/csv/csv';
import {
  EXPORT_MIME,
  type ExportFormat,
  type ReportBody,
  type TabularDocument,
} from '../../common/export/tabular';
import { renderPdf } from '../../common/export/pdf';
import { renderXlsx } from '../../common/export/xlsx';
import { Clock } from '../../common/time/clock';
import type { AuthContext } from '../auth/auth.types';
import { AttendanceReportService } from './attendance-report.service';
import { DiscountsReportService } from './discounts-report.service';
import type { EventsReportQueryDto } from './dto/events-report.query.dto';
import type { ReportFilterQueryDto } from './dto/report-filter.query.dto';
import { EventsReportService } from './events-report.service';
import { IncomeReportService } from './income-report.service';
import { ReportScopePort } from './ports/report-scope.port';
import { RegistrationsReportService } from './registrations-report.service';
import { describeReportFilters } from './report-filters';
import {
  attendanceBody,
  discountsBody,
  eventsBody,
  incomeBody,
  registrationsBody,
  transactionsBody,
} from './report-tables';
import type { ReportPeriod } from './reports-period';
import { toCsvTable } from './reports-csv';
import { TransactionsReportService } from './transactions-report.service';

/**
 * A report, as a file (US-RPT-11).
 *
 * Each method loads the SAME view the JSON endpoint returns, for the same
 * filter, so "the file contains only the rows I can see" holds by construction.
 * What this service adds is the context a file needs and a screen does not:
 * which filters produced it, and when its figures were taken.
 *
 * The format is chosen last, in `file`, because all three render from one
 * table — CSV, Excel and PDF cannot disagree about what the report says.
 */

/** The reports that can be exported, which is every report with rows. */
export const EXPORTABLE = [
  'registrations',
  'attendance',
  'events',
  'income',
  'discounts',
  'transactions',
] as const;
export type ExportableReport = (typeof EXPORTABLE)[number];

/**
 * How many rows an export will carry.
 *
 * A ceiling rather than no limit at all: the story's "very large export"
 * criterion asks for a prepared file and a notification, which is a separate
 * slice — until then a report that would run to tens of thousands of rows is
 * truncated rather than allowed to time out mid-download. The workbook and the
 * PDF say when they have been cut.
 */
export const EXPORT_LIMIT = 5000;

export interface ExportedFile {
  body: Buffer;
  type: string;
  filename: string;
}

@Injectable()
export class ReportExportService {
  constructor(
    private readonly registrations: RegistrationsReportService,
    private readonly attendance: AttendanceReportService,
    private readonly events: EventsReportService,
    private readonly income: IncomeReportService,
    private readonly discounts: DiscountsReportService,
    private readonly transactions: TransactionsReportService,
    private readonly scope: ReportScopePort,
    private readonly clock: Clock,
  ) {}

  async registrationsFile(
    auth: AuthContext,
    query: ReportFilterQueryDto,
  ): Promise<TabularDocument> {
    const view = await this.registrations.load(
      auth.organizationId,
      whole(query),
    );
    return this.document(auth, query, view.period, registrationsBody(view));
  }

  async attendanceFile(
    auth: AuthContext,
    query: ReportFilterQueryDto,
  ): Promise<TabularDocument> {
    const view = await this.attendance.load(auth.organizationId, whole(query));
    return this.document(auth, query, view.period, attendanceBody(view));
  }

  /**
   * Loaded with the whole `auth`, unlike its neighbours: the service masks each
   * row's revenue for a reader without finance access, and needs the caller's
   * permissions to do it (US-RPT-12).
   */
  async eventsFile(
    auth: AuthContext,
    query: EventsReportQueryDto,
  ): Promise<TabularDocument> {
    const view = await this.events.load(auth, whole(query));
    return this.document(auth, query, view.period, eventsBody(view));
  }

  async incomeFile(
    auth: AuthContext,
    query: ReportFilterQueryDto,
  ): Promise<TabularDocument> {
    const view = await this.income.load(auth.organizationId, whole(query));
    return this.document(auth, query, view.period, incomeBody(view));
  }

  async discountsFile(
    auth: AuthContext,
    query: ReportFilterQueryDto,
  ): Promise<TabularDocument> {
    const view = await this.discounts.load(auth.organizationId, whole(query));
    return this.document(auth, query, view.period, discountsBody(view));
  }

  async transactionsFile(
    auth: AuthContext,
    query: ReportFilterQueryDto,
  ): Promise<TabularDocument> {
    const view = await this.transactions.load(
      auth.organizationId,
      whole(query),
    );
    return this.document(auth, query, view.period, transactionsBody(view));
  }

  /** The report, plus what a file needs that a screen does not. */
  private async document(
    auth: AuthContext,
    query: EventsReportQueryDto,
    period: ReportPeriod,
    body: ReportBody,
  ): Promise<TabularDocument> {
    // Only looked up when there is something to look up — the common case is
    // "all events", which needs no query at all.
    const eventName = query.eventId
      ? await this.scope.eventName(auth.organizationId, query.eventId)
      : null;
    return {
      ...body,
      generatedAt: this.clock.now(),
      filters: describeReportFilters(query, period, eventName),
    };
  }

  /**
   * The same document as whichever file was asked for.
   *
   * The CSV keeps its byte-order mark: Excel assumes the local codepage
   * without it, and a Thai event name opens as mojibake (US-RPT-11 AC3).
   */
  async file(
    report: ExportableReport,
    format: ExportFormat,
    doc: TabularDocument,
  ): Promise<ExportedFile> {
    return {
      body: await this.render(format, doc),
      type: EXPORT_MIME[format],
      filename: `${report}.${format}`,
    };
  }

  private async render(
    format: ExportFormat,
    doc: TabularDocument,
  ): Promise<Buffer> {
    if (format === 'xlsx') return renderXlsx(doc);
    if (format === 'pdf') return renderPdf(doc);
    const table = toCsvTable(doc.table);
    return Buffer.from(toCsv(table.headers, table.rows), 'utf8');
  }
}

/** The whole filtered set, not the page that happened to be on screen. */
function whole<T extends { page?: number; limit?: number }>(query: T): T {
  return { ...query, page: 1, limit: EXPORT_LIMIT };
}
