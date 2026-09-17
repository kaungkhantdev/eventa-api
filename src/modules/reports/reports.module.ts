import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { PaymentsModule } from '../payments/payments.module';
import { RegistrationStatsModule } from '../registration-stats/registration-stats.module';
import { AttendanceReportService } from './attendance-report.service';
import { IncomeReportService } from './income-report.service';
import { OverviewReportService } from './overview-report.service';
import { RegistrationsReportService } from './registrations-report.service';
import { ReportsController } from './reports.controller';

/**
 * Reporting across the workspace (US-RPT-01…12). Read-only.
 *
 * Reports spans four contexts — registrations, payments, check-ins and
 * promotions — and reads none of their tables. Each is reached through a port
 * this module declares in `ports/` and the owning module implements, so a
 * column changing in Registration cannot silently break a report.
 *
 * Every report shares one window and one filter (`reports-period`,
 * `ReportFilterQueryDto`). That is not tidiness: US-RPT-12 requires the reports
 * to agree with one another, which they cannot do if each parses its own dates.
 */
@Module({
  // AccessModule for PermissionsService, which `PermissionsGuard` on the
  // controller needs: US-RPT-12 gates every report on a permission.
  imports: [AccessModule, PaymentsModule, RegistrationStatsModule],
  controllers: [ReportsController],
  providers: [
    AttendanceReportService,
    IncomeReportService,
    OverviewReportService,
    RegistrationsReportService,
  ],
})
export class ReportsModule {}
