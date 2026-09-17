import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/time/clock';
import {
  DEFAULT_REPORT_LIMIT,
  type ReportFilterQueryDto,
} from './dto/report-filter.query.dto';
import {
  IncomeReportPort,
  type IncomeRow,
  type IncomeTotals,
} from './ports/income-report.port';
import { resolveReportPeriod, type ReportPeriod } from './reports-period';

/**
 * Income and reconciliation (US-RPT-05).
 *
 * Gross, VAT, refunds and fees per event, with two bottom lines: `net`, which
 * is the revenue figure the overview shows, and `settled`, which is what
 * reaches the bank once the provider has taken its cut.
 *
 * Every figure comes from Payments through `IncomeReportPort` — this service
 * does no arithmetic on money at all, which is what keeps one definition of
 * "revenue" in the codebase rather than two.
 */

export interface IncomeReportView {
  period: ReportPeriod;
  rows: IncomeRow[];
  matchedEvents: number;
  totals: IncomeTotals;
}

@Injectable()
export class IncomeReportService {
  constructor(
    private readonly income: IncomeReportPort,
    private readonly clock: Clock,
  ) {}

  async load(
    organizationId: number,
    filter: ReportFilterQueryDto,
  ): Promise<IncomeReportView> {
    const period = resolveReportPeriod(filter, this.clock.now());

    const page = await this.income.incomeByEvent(organizationId, {
      from: period.from,
      to: period.to,
      eventId: filter.eventId,
      search: filter.q,
      page: filter.page ?? 1,
      limit: filter.limit ?? DEFAULT_REPORT_LIMIT,
    });

    return {
      period,
      rows: page.rows,
      matchedEvents: page.matchedEvents,
      totals: page.totals,
    };
  }
}
