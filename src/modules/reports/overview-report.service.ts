import { Injectable } from '@nestjs/common';
import {
  comparePeriod,
  type PeriodChange,
} from '../../common/analytics/period-change';
import { Permission } from '../../common/decorators/require-permissions.decorator';
import { Clock } from '../../common/time/clock';
import { PermissionsService } from '../access/permissions.service';
import type { AuthContext } from '../auth/auth.types';
import type { ReportFilterQueryDto } from './dto/report-filter.query.dto';
import {
  AttendanceReportPort,
  type AttendanceWindow,
} from './ports/attendance-report.port';
import {
  IncomeReportPort,
  type IncomeSummary,
} from './ports/income-report.port';
import { RegistrationReportPort } from './ports/registration-report.port';
import { changeBetween } from './report-change';
import { resolveReportPeriod, type ReportPeriod } from './reports-period';
import {
  bucketRevenue,
  granularityFor,
  type TrendGranularity,
  type TrendPoint,
} from './revenue-trend';

/**
 * Workspace health at a glance (US-RPT-01).
 *
 * Five tiles and a revenue chart, all describing ONE window and all compared
 * against the same previous one — resolved once and handed to every port, so the
 * revenue tile and the chart's headline cannot disagree about what "this year"
 * meant.
 *
 * This service owns the arithmetic that turns counts into meaning: which way is
 * an improvement for each metric, and when a figure or a comparison has no
 * honest answer. It owns none of the arithmetic on money — `net` arrives from
 * Payments already computed, which is what keeps this screen's revenue and the
 * income report's identical rather than merely similar.
 */

/** A headline card: the figure, and how it moved. `value` null = unknown. */
export interface OverviewKpi {
  value: number | null;
  change: PeriodChange;
}

export interface RevenueTrendView {
  granularity: TrendGranularity;
  /** The same figure as the revenue tile, from the same call. */
  totalSatang: number;
  change: PeriodChange;
  points: TrendPoint[];
}

/**
 * The three money tiles are null together, and only when the caller lacks
 * `finView` — withheld, never zeroed (US-RPT-12).
 */
export interface OverviewKpis {
  registrations: OverviewKpi;
  attendanceRate: OverviewKpi;
  revenueSatang: OverviewKpi | null;
  averageTicketSatang: OverviewKpi | null;
  refundRate: OverviewKpi | null;
}

export interface OverviewReportView {
  period: ReportPeriod;
  kpis: OverviewKpis;
  /** Null without finance access: the panel is not shown at all. */
  revenue: RevenueTrendView | null;
}

const PERCENT = 100;

@Injectable()
export class OverviewReportService {
  constructor(
    private readonly income: IncomeReportPort,
    private readonly registrations: RegistrationReportPort,
    private readonly attendance: AttendanceReportPort,
    private readonly permissions: PermissionsService,
    private readonly clock: Clock,
  ) {}

  async load(
    auth: AuthContext,
    filter: ReportFilterQueryDto,
  ): Promise<OverviewReportView> {
    const period = resolveReportPeriod(filter, this.clock.now());
    const scope = { eventId: filter.eventId, search: filter.q };
    const current = { from: period.from, to: period.to, ...scope };
    const previous = {
      from: period.previousFrom,
      to: period.previousTo,
      ...scope,
    };

    const org = auth.organizationId;
    const granted = await this.permissions.getFor(org, auth.userId);
    // Checked BEFORE the money is fetched, not after: an unauthorized caller
    // should not have the figures read into the process at all.
    const finance = granted.includes(Permission.finView);

    const [signUps, signUpsBefore, doors, doorsBefore, money, moneyBefore] =
      await Promise.all([
        this.registrations.totalsFor(org, current),
        this.registrations.totalsFor(org, previous),
        this.attendance.totalsFor(org, current),
        this.attendance.totalsFor(org, previous),
        finance ? this.income.incomeTotals(org, current) : null,
        finance ? this.income.incomeTotals(org, previous) : null,
      ]);

    const takings = money && moneyBefore ? { money, moneyBefore } : null;
    return {
      period,
      kpis: {
        // Confirmed seats, not every order state: a cancelled or rejected
        // registration is not one the organizer holds, and counting it would
        // make this tile RISE as people withdrew.
        registrations: kpi(signUps.confirmed, signUpsBefore.confirmed),
        attendanceRate: kpi(attendanceRate(doors), attendanceRate(doorsBefore)),
        ...moneyKpis(takings),
      },
      revenue: takings ? await this.trend(org, period, current, takings) : null,
    };
  }

  private async trend(
    organizationId: number,
    period: ReportPeriod,
    window: AttendanceWindow,
    takings: Takings,
  ): Promise<RevenueTrendView> {
    const granularity = granularityFor(period.days);
    return {
      granularity,
      totalSatang: takings.money.netSatang,
      change: comparePeriod(
        takings.money.netSatang,
        takings.moneyBefore.netSatang,
      ),
      points: bucketRevenue(
        await this.income.netByDay(organizationId, window),
        period,
        granularity,
      ),
    };
  }
}

interface Takings {
  money: IncomeSummary;
  moneyBefore: IncomeSummary;
}

/** A card from two figures; `changeBetween` owns what an unknown side means. */
function kpi(
  current: number | null,
  previous: number | null,
  options: { higherIsBetter?: boolean } = {},
): OverviewKpi {
  return { value: current, change: changeBetween(current, previous, options) };
}

/** The three finance tiles, or three nulls when the caller may not see them. */
function moneyKpis(
  takings: Takings | null,
): Pick<OverviewKpis, 'revenueSatang' | 'averageTicketSatang' | 'refundRate'> {
  if (takings === null) {
    return {
      revenueSatang: null,
      averageTicketSatang: null,
      refundRate: null,
    };
  }
  const { money, moneyBefore } = takings;
  return {
    revenueSatang: kpi(money.netSatang, moneyBefore.netSatang),
    averageTicketSatang: kpi(averageTicket(money), averageTicket(moneyBefore)),
    // The one tile where down is up: US-RPT-01 requires a falling refund rate
    // to read as a win rather than as a loss.
    refundRate: kpi(refundRate(money), refundRate(moneyBefore), {
      higherIsBetter: false,
    }),
  };
}

/**
 * What a ticket sold for on average, VAT included — the price the buyer was
 * actually charged.
 *
 * Over the seats that were PAID for. A free registration has no price, and
 * putting it in the denominator would report an average nobody was charged.
 */
function averageTicket(money: IncomeSummary): number | null {
  if (money.paidSeats === 0) return null;
  return Math.round(money.grossSatang / money.paidSeats);
}

/** The share of what was taken that went back. */
function refundRate(money: IncomeSummary): number | null {
  return rate(money.refundsSatang, money.grossSatang);
}

/** Of those expected at events that have started, the share who arrived. */
function attendanceRate(doors: {
  registered: number;
  checkedIn: number;
}): number | null {
  return rate(doors.checkedIn, doors.registered);
}

/** A percentage to one decimal, or null when the denominator is nothing. */
function rate(part: number, whole: number): number | null {
  if (whole === 0) return null;
  return Math.round((part / whole) * PERCENT * 10) / 10;
}
