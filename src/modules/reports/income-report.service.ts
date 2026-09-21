import { Injectable } from '@nestjs/common';
import type { PeriodChange } from '../../common/analytics/period-change';
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
import {
  changeBetween,
  LOWER_IS_BETTER,
  undirectedChange,
} from './report-change';
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

/**
 * How each money tile moved against the previous equal period.
 *
 * Gross, net and settled read the usual way round. Refunds and fees are money
 * LEAVING, so a fall is the improvement. VAT carries no verdict at all — it was
 * never the organizer's to gain or lose.
 */
export type IncomeChanges = Record<keyof IncomeTotals, PeriodChange>;

export interface IncomeReportView {
  period: ReportPeriod;
  rows: IncomeRow[];
  matchedEvents: number;
  totals: IncomeTotals;
  changes: IncomeChanges;
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

    const scope = { eventId: filter.eventId, search: filter.q };
    const [page, before] = await Promise.all([
      this.income.incomeByEvent(organizationId, {
        from: period.from,
        to: period.to,
        ...scope,
        page: filter.page ?? 1,
        limit: filter.limit ?? DEFAULT_REPORT_LIMIT,
      }),
      this.income.incomeTotals(organizationId, {
        from: period.previousFrom,
        to: period.previousTo,
        ...scope,
      }),
    ]);

    return {
      period,
      rows: page.rows,
      matchedEvents: page.matchedEvents,
      totals: page.totals,
      changes: changesBetween(page.totals, before),
    };
  }
}

function changesBetween(
  now: IncomeTotals,
  before: IncomeTotals,
): IncomeChanges {
  return {
    grossSatang: changeBetween(now.grossSatang, before.grossSatang),
    // Neither a gain nor a loss: it is the Revenue Department's money in both
    // periods, and colouring it would claim something untrue about it.
    vatSatang: undirectedChange(now.vatSatang, before.vatSatang),
    refundsSatang: changeBetween(
      now.refundsSatang,
      before.refundsSatang,
      LOWER_IS_BETTER,
    ),
    feesSatang: changeBetween(
      now.feesSatang,
      before.feesSatang,
      LOWER_IS_BETTER,
    ),
    netSatang: changeBetween(now.netSatang, before.netSatang),
    settledSatang: changeBetween(now.settledSatang, before.settledSatang),
  };
}
