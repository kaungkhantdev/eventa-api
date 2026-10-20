import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/time/clock';
import { type ReportFilterQueryDto } from './dto/report-filter.query.dto';
import {
  PayoutReportPort,
  type PayoutReportRow,
  type PayoutReportTotals,
} from './ports/payout-report.port';
import { resolveReportPeriod, type ReportPeriod } from './reports-period';
import { DEFAULT_REPORT_LIMIT } from '../../common/constants/reports.constants';

/**
 * Payouts and settlement (US-RPT-07).
 *
 * Read-only, like every report: the rows arrive from Payouts already masked and
 * already in the report's three statuses, and the sums are taken over the whole
 * filter by the same query that picked the rows.
 *
 * The one figure worked out here is the average payout, because it is the one
 * whose honest answer can be "none".
 */

export interface PayoutTotalsView extends PayoutReportTotals {
  /** The mean of every payout the report shows, whole satang. Null when none. */
  averageSatang: number | null;
}

export interface PayoutsReportView {
  period: ReportPeriod;
  rows: PayoutReportRow[];
  matchedPayouts: number;
  totals: PayoutTotalsView;
}

@Injectable()
export class PayoutsReportService {
  constructor(
    private readonly payouts: PayoutReportPort,
    private readonly clock: Clock,
  ) {}

  async load(
    organizationId: number,
    filter: ReportFilterQueryDto,
  ): Promise<PayoutsReportView> {
    const period = resolveReportPeriod(filter, this.clock.now());

    const page = await this.payouts.payouts(organizationId, {
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
      matchedPayouts: page.matchedPayouts,
      totals: { ...page.totals, averageSatang: averageOf(page.totals) },
    };
  }
}

/**
 * The mean payout over every one the report shows — paid, in transit and
 * pending alike, since those are all the report holds.
 *
 * Null rather than zero when nothing matched: there is no average of no
 * payouts, and ฿0 would read as a payout of nothing.
 */
function averageOf(totals: PayoutReportTotals): number | null {
  if (totals.payouts === 0) return null;
  const sum =
    totals.paidOutSatang + totals.inTransitSatang + totals.pendingSatang;
  return Math.round(sum / totals.payouts);
}
