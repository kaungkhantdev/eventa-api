import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiTags } from '@nestjs/swagger';
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
import type { AuthContext } from '../auth/auth.types';
import { AttendanceReportDto } from './dto/attendance-report.dto';
import { IncomeReportDto } from './dto/income-report.dto';
import { OverviewReportDto } from './dto/overview-report.dto';
import { ReportFilterQueryDto } from './dto/report-filter.query.dto';
import { RegistrationsReportDto } from './dto/registrations-report.dto';
import { AttendanceReportService } from './attendance-report.service';
import { IncomeReportService } from './income-report.service';
import { OverviewReportService } from './overview-report.service';
import { RegistrationsReportService } from './registrations-report.service';
import {
  toAttendanceReport,
  toIncomeReport,
  toOverviewReport,
  toRegistrationsReport,
} from './reports.mapper';

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
    private readonly registrations: RegistrationsReportService,
    private readonly income: IncomeReportService,
    private readonly attendance: AttendanceReportService,
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
}
