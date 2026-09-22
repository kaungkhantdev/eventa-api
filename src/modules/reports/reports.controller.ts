import {
  Controller,
  Get,
  Param,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import {
  Permission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ApiErrorDto } from '../../common/errors/error-envelope';
import { AdminGuard } from '../../common/guards/admin.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ApiData } from '../../common/http/api-data.decorator';
import { SkipResponseEnvelope } from '../../common/decorators/skip-envelope.decorator';
import {
  EXPORT_FORMATS,
  EXPORT_MIME,
  type ExportFormat,
  type TabularDocument,
} from '../../common/export/tabular';
import type { AuthContext } from '../auth/auth.types';
import { AttendanceReportDto } from './dto/attendance-report.dto';
import { DiscountsReportDto } from './dto/discounts-report.dto';
import { TransactionsReportDto } from './dto/transactions-report.dto';
import { EventsReportDto } from './dto/events-report.dto';
import { EventsReportQueryDto } from './dto/events-report.query.dto';
import { IncomeReportDto } from './dto/income-report.dto';
import { OverviewReportDto } from './dto/overview-report.dto';
import { ReportFilterQueryDto } from './dto/report-filter.query.dto';
import { RegistrationsReportDto } from './dto/registrations-report.dto';
import { AttendanceReportService } from './attendance-report.service';
import { DiscountsReportService } from './discounts-report.service';
import { TransactionsReportService } from './transactions-report.service';
import { EventsReportService } from './events-report.service';
import { IncomeReportService } from './income-report.service';
import { OverviewReportService } from './overview-report.service';
import { RegistrationsReportService } from './registrations-report.service';
import { ExportFormatPipe } from './export-format.pipe';
import {
  ReportExportService,
  type ExportableReport,
} from './report-export.service';
import {
  toAttendanceReport,
  toDiscountsReport,
  toTransactionsReport,
  toEventsReport,
  toIncomeReport,
  toOverviewReport,
  toRegistrationsReport,
} from './reports.mapper';

/**
 * Every MIME an export route can answer with, for the OpenAPI document.
 *
 * Declared before the controller: `@ApiProduces` runs when the class is
 * defined, which is before a `const` below it has been initialised.
 */
const PRODUCES = Object.values(EXPORT_MIME);

/**
 * The reporting surface (US-RPT-01…12). Read-only throughout: no endpoint here
 * changes an event, a registration, a payment, a payout or a discount.
 *
 * Each report is gated by the data it exposes rather than by being a "report":
 * registrations and attendance are staff-visible (`regView`), everything with
 * money on it is finance-only (`finView`) — US-RPT-12.
 */
@ApiTags('reports')
@ApiBearerAuth()
@ApiForbiddenResponse({
  description: 'Admin persona or required permission missing',
  type: ApiErrorDto,
})
@UseGuards(AdminGuard, PermissionsGuard)
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly overview: OverviewReportService,
    private readonly events: EventsReportService,
    private readonly discounts: DiscountsReportService,
    private readonly transactions: TransactionsReportService,
    private readonly registrations: RegistrationsReportService,
    private readonly income: IncomeReportService,
    private readonly attendance: AttendanceReportService,
    private readonly exports: ReportExportService,
  ) {}

  /**
   * Gated on `regView` rather than `finView` although it carries money: the
   * three money tiles and the revenue chart are withheld INSIDE, by the service,
   * so an organizer without finance access still gets the registrations and
   * attendance half of the screen instead of a 403 (US-RPT-12).
   */
  @Get('overview')
  @RequirePermissions(Permission.regView)
  @ResponseMessage('Overview retrieved.')
  @ApiData(OverviewReportDto)
  async overviewReport(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ReportFilterQueryDto,
  ): Promise<OverviewReportDto> {
    return toOverviewReport(await this.overview.load(auth, query));
  }

  /**
   * Gated on `regView` although each row carries revenue: the money is withheld
   * per row inside the service, so an organizer without finance access still
   * gets the ranking (US-RPT-12).
   */
  @Get('events')
  @RequirePermissions(Permission.regView)
  @ResponseMessage('Event performance retrieved.')
  @ApiData(EventsReportDto)
  async eventsReport(
    @CurrentAuth() auth: AuthContext,
    @Query() query: EventsReportQueryDto,
  ): Promise<EventsReportDto> {
    return toEventsReport(await this.events.load(auth, query));
  }

  /** Every row is a charge or a reversal: finance-only (US-RPT-12). */
  @Get('transactions')
  @RequirePermissions(Permission.finView)
  @ResponseMessage('Transaction ledger retrieved.')
  @ApiData(TransactionsReportDto)
  async transactionsReport(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ReportFilterQueryDto,
  ): Promise<TransactionsReportDto> {
    return toTransactionsReport(
      await this.transactions.load(auth.organizationId, query),
    );
  }

  /** Money on every row, so finance-only throughout (US-RPT-12). */
  @Get('discounts')
  @RequirePermissions(Permission.finView)
  @ResponseMessage('Discount payback retrieved.')
  @ApiData(DiscountsReportDto)
  async discountsReport(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ReportFilterQueryDto,
  ): Promise<DiscountsReportDto> {
    return toDiscountsReport(
      await this.discounts.load(auth.organizationId, query),
    );
  }

  @Get('registrations')
  @RequirePermissions(Permission.regView)
  @ResponseMessage('Registrations report retrieved.')
  @ApiData(RegistrationsReportDto)
  async registrationsReport(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ReportFilterQueryDto,
  ): Promise<RegistrationsReportDto> {
    const view = await this.registrations.load(auth.organizationId, query);
    return toRegistrationsReport(view);
  }

  @Get('income')
  @RequirePermissions(Permission.finView)
  @ResponseMessage('Income report retrieved.')
  @ApiData(IncomeReportDto)
  async incomeReport(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ReportFilterQueryDto,
  ): Promise<IncomeReportDto> {
    const view = await this.income.load(auth.organizationId, query);
    return toIncomeReport(view);
  }

  @Get('attendance')
  @RequirePermissions(Permission.regView)
  @ResponseMessage('Attendance report retrieved.')
  @ApiData(AttendanceReportDto)
  async attendanceReport(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ReportFilterQueryDto,
  ): Promise<AttendanceReportDto> {
    const view = await this.attendance.load(auth.organizationId, query);
    return toAttendanceReport(view);
  }

  /* ── the same reports, as files (US-RPT-11) ──────────────────────────── */

  /**
   * Every export takes the SAME filter as the report it mirrors and is built
   * from the same view, so the file holds exactly the rows on screen — which
   * is the story's requirement, and is true by construction rather than by two
   * code paths being kept in step.
   *
   * Paging is deliberately dropped: an export is the whole filtered set, not
   * the twenty rows that happened to be visible.
   *
   * The format is the extension on the path — `registrations.xlsx` — so all
   * three render from one table and cannot disagree, and an unknown one is a
   * route that does not exist rather than a bad parameter. The permission gate
   * is the report's own, whichever file is asked for (US-RPT-12).
   */
  @Get('registrations.:format')
  @RequirePermissions(Permission.regView)
  @SkipResponseEnvelope()
  @ApiParam({ name: 'format', enum: EXPORT_FORMATS })
  @ApiProduces(...PRODUCES)
  async registrationsExport(
    @CurrentAuth() auth: AuthContext,
    @Param('format', ExportFormatPipe) format: ExportFormat,
    @Query() query: ReportFilterQueryDto,
  ): Promise<StreamableFile> {
    const doc = await this.exports.registrationsFile(auth, query);
    return this.download('registrations', format, doc);
  }

  @Get('attendance.:format')
  @RequirePermissions(Permission.regView)
  @SkipResponseEnvelope()
  @ApiParam({ name: 'format', enum: EXPORT_FORMATS })
  @ApiProduces(...PRODUCES)
  async attendanceExport(
    @CurrentAuth() auth: AuthContext,
    @Param('format', ExportFormatPipe) format: ExportFormat,
    @Query() query: ReportFilterQueryDto,
  ): Promise<StreamableFile> {
    const doc = await this.exports.attendanceFile(auth, query);
    return this.download('attendance', format, doc);
  }

  @Get('events.:format')
  @RequirePermissions(Permission.regView)
  @SkipResponseEnvelope()
  @ApiParam({ name: 'format', enum: EXPORT_FORMATS })
  @ApiProduces(...PRODUCES)
  async eventsExport(
    @CurrentAuth() auth: AuthContext,
    @Param('format', ExportFormatPipe) format: ExportFormat,
    @Query() query: EventsReportQueryDto,
  ): Promise<StreamableFile> {
    const doc = await this.exports.eventsFile(auth, query);
    return this.download('events', format, doc);
  }

  @Get('income.:format')
  @RequirePermissions(Permission.finView)
  @SkipResponseEnvelope()
  @ApiParam({ name: 'format', enum: EXPORT_FORMATS })
  @ApiProduces(...PRODUCES)
  async incomeExport(
    @CurrentAuth() auth: AuthContext,
    @Param('format', ExportFormatPipe) format: ExportFormat,
    @Query() query: ReportFilterQueryDto,
  ): Promise<StreamableFile> {
    const doc = await this.exports.incomeFile(auth, query);
    return this.download('income', format, doc);
  }

  @Get('discounts.:format')
  @RequirePermissions(Permission.finView)
  @SkipResponseEnvelope()
  @ApiParam({ name: 'format', enum: EXPORT_FORMATS })
  @ApiProduces(...PRODUCES)
  async discountsExport(
    @CurrentAuth() auth: AuthContext,
    @Param('format', ExportFormatPipe) format: ExportFormat,
    @Query() query: ReportFilterQueryDto,
  ): Promise<StreamableFile> {
    const doc = await this.exports.discountsFile(auth, query);
    return this.download('discounts', format, doc);
  }

  @Get('transactions.:format')
  @RequirePermissions(Permission.finView)
  @SkipResponseEnvelope()
  @ApiParam({ name: 'format', enum: EXPORT_FORMATS })
  @ApiProduces(...PRODUCES)
  async transactionsExport(
    @CurrentAuth() auth: AuthContext,
    @Param('format', ExportFormatPipe) format: ExportFormat,
    @Query() query: ReportFilterQueryDto,
  ): Promise<StreamableFile> {
    const doc = await this.exports.transactionsFile(auth, query);
    return this.download('transactions', format, doc);
  }

  /**
   * A `StreamableFile` rather than the buffer itself: a Buffer returned from a
   * handler is JSON-serialised by the express adapter, which would hand the
   * reader a page of byte numbers instead of a workbook.
   *
   * No `@Header` decorators — those would label an ERROR response as a
   * spreadsheet too. `AllExceptionsFilter` already forces `application/json`
   * on a refusal, and the headers set here only reach a file that exists.
   */
  private async download(
    report: ExportableReport,
    format: ExportFormat,
    doc: TabularDocument,
  ): Promise<StreamableFile> {
    const { body, type, filename } = await this.exports.file(
      report,
      format,
      doc,
    );
    return new StreamableFile(body, {
      type,
      disposition: `attachment; filename="${filename}"`,
    });
  }
}
