import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { DiscountsModule } from '../discounts/discounts.module';
import { PaymentsModule } from '../payments/payments.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { RegistrationStatsModule } from '../registration-stats/registration-stats.module';
import { AttendanceReportService } from './attendance-report.service';
import { DiscountsReportService } from './discounts-report.service';
import { TransactionsReportService } from './transactions-report.service';
import { PayoutsReportService } from './payouts-report.service';
import { EventsReportService } from './events-report.service';
import { IncomeReportService } from './income-report.service';
import { OverviewReportService } from './overview-report.service';
import { RegistrationsReportService } from './registrations-report.service';
import { ReportExportService } from './report-export.service';
import { ReportsController } from './reports.controller';

/**
 * Reporting across the workspace (US-RPT-01…12). Read-only.
 *
 * Reports spans five contexts — registrations, payments, payouts, check-ins
 * and promotions — and reads none of their tables. Each is reached through a port
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
  // AuditModule because US-RPT-12 also requires every export to be recorded.
  imports: [
    AccessModule,
    AuditModule,
    DiscountsModule,
    PaymentsModule,
    PayoutsModule,
    RegistrationStatsModule,
  ],
  controllers: [ReportsController],
  providers: [
    AttendanceReportService,
    DiscountsReportService,
    EventsReportService,
    IncomeReportService,
    OverviewReportService,
    RegistrationsReportService,
    TransactionsReportService,
    PayoutsReportService,
    // The same seven reports as CSV, Excel or PDF (US-RPT-11).
    ReportExportService,
  ],
})
export class ReportsModule {}
