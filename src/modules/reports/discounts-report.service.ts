import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/time/clock';
import {
  DEFAULT_REPORT_LIMIT,
  type ReportFilterQueryDto,
} from './dto/report-filter.query.dto';
import {
  DiscountReportPort,
  type DiscountPerformanceRow,
  type DiscountStanding,
} from './ports/discount-report.port';
import { resolveReportPeriod, type ReportPeriod } from './reports-period';

/**
 * Promotion and discount payback (US-RPT-10).
 *
 * Which codes exist and what they cost is Discounts' answer. What this service
 * owns is how a code READS — its terms, its scope — and the one derived figure
 * on the screen: the return it gave, which has cases where there is no honest
 * number and must say so rather than print a zero.
 */

/** A code's row, with the wording and the ratio worked out. */
export interface DiscountPerformanceView {
  discountId: string;
  code: string;
  standing: DiscountStanding;
  /** "25% off" for a percentage code; null for a fixed one — see below. */
  terms: string | null;
  /**
   * The amount a FIXED code takes off, integer satang; null for a percentage
   * one. Money stays an integer until the edge formats it, so the wording for
   * a fixed code is finished there rather than here.
   */
  fixedValueSatang: number | null;
  /** The event it applies to, or "All events". */
  scope: string;
  redemptions: number;
  discountSatang: number;
  influencedSatang: number;
  /** Baht of orders per Baht given away. Null when there is no honest figure. */
  returnRatio: number | null;
}

export interface DiscountsReportView {
  period: ReportPeriod;
  rows: DiscountPerformanceView[];
  matchedCodes: number;
  totals: {
    activeCodes: number;
    redemptions: number;
    discountSatang: number;
    influencedSatang: number;
    returnRatio: number | null;
  };
}

const ALL_EVENTS = 'All events';

@Injectable()
export class DiscountsReportService {
  constructor(
    private readonly discounts: DiscountReportPort,
    private readonly clock: Clock,
  ) {}

  async load(
    organizationId: number,
    filter: ReportFilterQueryDto,
  ): Promise<DiscountsReportView> {
    const period = resolveReportPeriod(filter, this.clock.now());

    const page = await this.discounts.payback(organizationId, {
      from: period.from,
      to: period.to,
      eventId: filter.eventId,
      search: filter.q,
      page: filter.page ?? 1,
      limit: filter.limit ?? DEFAULT_REPORT_LIMIT,
    });

    return {
      period,
      rows: page.rows.map(toView),
      matchedCodes: page.matchedCodes,
      totals: {
        ...page.totals,
        returnRatio: ratioOf(
          page.totals.influencedSatang,
          page.totals.discountSatang,
        ),
      },
    };
  }
}

function toView(row: DiscountPerformanceRow): DiscountPerformanceView {
  const percent = row.kind === 'percent';
  return {
    discountId: row.discountId,
    code: row.code,
    standing: row.standing,
    terms: percent ? `${row.value}% off` : null,
    fixedValueSatang: percent ? null : row.value,
    scope: row.eventName ?? ALL_EVENTS,
    redemptions: row.redemptions,
    discountSatang: row.discountSatang,
    influencedSatang: row.influencedSatang,
    returnRatio: ratioOf(row.influencedSatang, row.discountSatang),
  };
}

/**
 * Baht of orders per Baht given away.
 *
 * Null rather than zero where nothing was given away: a code nobody has
 * redeemed has no return to report, and a code that cost nothing would divide
 * by zero. Both are "there is no such number", which is not the same as "the
 * promotion paid back nothing".
 */
function ratioOf(influenced: number, discount: number): number | null {
  if (discount === 0) return null;
  return Math.round((influenced / discount) * 10) / 10;
}
