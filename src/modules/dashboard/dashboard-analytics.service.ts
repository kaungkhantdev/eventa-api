import { Injectable } from '@nestjs/common';
import { Permission } from '../../common/decorators/require-permissions.decorator';
import { Clock } from '../../common/time/clock';
import { PermissionsService } from '../access/permissions.service';
import type { AuthContext } from '../auth/auth.types';
import type { TodayFeedItem } from './dashboard-home.service';
import {
  type DashboardRange,
  type Period,
  type PeriodChange,
  comparePeriod,
  periodFor,
} from './period';
import {
  CheckInInsightsPort,
  EventInsightsPort,
  InventoryInsightsPort,
  type SellingFastTier,
} from './ports/operations-insights.port';
import { RegistrationInsightsPort } from './ports/registration-insights.port';
import {
  RevenueInsightsPort,
  type RevenuePoint,
} from './ports/revenue-insights.port';

/** How many rows the dashboard table shows before "view all". */
const TABLE_LIMIT = 10;
/** How many low-stock tiers the selling-fast panel previews before "Manage". */
const SELLING_FAST_LIMIT = 3;
const PERCENT = 100;

/** A headline card: the figure, and how it moved. `value` is null when unknown. */
export interface Kpi {
  value: number | null;
  change: PeriodChange;
}

export interface RevenueTrend {
  range: DashboardRange;
  totalSatang: number;
  change: PeriodChange;
  points: RevenuePoint[];
}

export interface TierSlice {
  ticketTypeName: string;
  count: number;
  percent: number;
}

export interface AnalyticsView {
  kpis: {
    registrations: Kpi;
    /** Null when the caller has no finance access — withheld, not zeroed. */
    revenueSatang: Kpi | null;
    upcomingEvents: Kpi;
    checkInRate: Kpi;
    capacityFilled: Kpi;
  };
  /** Null when the caller has no finance access: the section is not shown at all. */
  revenue: RevenueTrend | null;
  recent: TodayFeedItem[];
  tierMix: TierSlice[];
  /** Tiers close to selling out, scarcest first (US-DASH-11). */
  sellingFast: SellingFastTier[];
  generatedAt: Date;
}

export interface AnalyticsQuery {
  range?: DashboardRange;
}

/**
 * The analytics dashboard (US-DASH-08/09/12).
 *
 * Everything on it describes ONE period, resolved once and passed to every
 * port, so the KPI, the trend total and the ticket-type mix cannot disagree
 * about what "this year" meant — US-DASH-13's consistency requirement is a
 * property of that shared window rather than something to reconcile afterwards.
 *
 * The two nulls are load-bearing. A KPI with no data reports `value: null` — a
 * check-in rate over zero expected attendees is not "0% turned up" — and the
 * whole revenue section is null without `finView`, having never been queried.
 */
@Injectable()
export class DashboardAnalyticsService {
  constructor(
    private readonly registrations: RegistrationInsightsPort,
    private readonly revenue: RevenueInsightsPort,
    private readonly events: EventInsightsPort,
    private readonly checkIns: CheckInInsightsPort,
    private readonly inventory: InventoryInsightsPort,
    private readonly permissions: PermissionsService,
    private readonly clock: Clock,
  ) {}

  async load(auth: AuthContext, query: AnalyticsQuery): Promise<AnalyticsView> {
    const now = this.clock.now();
    const range = query.range ?? DEFAULT_RANGE;
    const period = periodFor(range, now);
    const granted = await this.permissions.getFor(
      auth.organizationId,
      auth.userId,
    );
    const access = {
      registrations: granted.includes(Permission.regView),
      finance: granted.includes(Permission.finView),
    };
    const org = auth.organizationId;
    const [signUps, money, reach, attendance, recent, mix, sellingFast] =
      await Promise.all([
        this.registrations.totalsForPeriod(org, period),
        access.finance ? this.revenue.totalsForPeriod(org, period) : null,
        this.events.reach(org),
        this.attendance(org, period),
        this.recentRows(org, access),
        this.registrations.tierMix(org, { from: period.from, to: period.to }),
        // Not period-scoped and not gated: what is left of an allocation is
        // neither money nor personal data, and "about to sell out" is true
        // right now regardless of which window the rest of the page is showing.
        this.inventory.sellingFast(org, SELLING_FAST_LIMIT),
      ]);
    return {
      kpis: {
        registrations: kpi(signUps.current, signUps.previous),
        revenueSatang: money ? kpi(money.current, money.previous) : null,
        // A snapshot, not a window: there is no "previous" number of events yet
        // to start, so the card shows the figure with a neutral change.
        upcomingEvents: { value: reach.upcoming, change: FLAT },
        checkInRate: kpi(attendance.current, attendance.previous, {
          higherIsBetter: true,
        }),
        capacityFilled: { value: reach.capacityFilledPercent, change: FLAT },
      },
      revenue: money ? await this.trend(org, period, range, money) : null,
      recent,
      tierMix: toSlices(mix, signUps.current),
      sellingFast,
      generatedAt: now,
    };
  }

  private async trend(
    organizationId: number,
    period: Period,
    range: DashboardRange,
    money: { current: number; previous: number },
  ): Promise<RevenueTrend> {
    return {
      range,
      // The same figure the KPI card shows, from the same call — US-DASH-09's
      // note that the two must agree is satisfied by construction.
      totalSatang: money.current,
      change: comparePeriod(money.current, money.previous),
      points: await this.revenue.trend(organizationId, {
        from: period.from,
        to: period.to,
      }),
    };
  }

  private async recentRows(
    organizationId: number,
    access: { registrations: boolean; finance: boolean },
  ): Promise<TodayFeedItem[]> {
    if (!access.registrations) return [];
    const rows = await this.registrations.recent(organizationId, TABLE_LIMIT);
    return rows.map((row) => ({
      ...row,
      totalSatang: access.finance ? row.totalSatang : null,
    }));
  }

  /** The rate for this period and the last, as percentages or null. */
  private async attendance(
    organizationId: number,
    period: Period,
  ): Promise<{ current: number | null; previous: number | null }> {
    const [current, previous] = await Promise.all([
      this.checkIns.rateForPeriod(organizationId, {
        from: period.from,
        to: period.to,
      }),
      this.checkIns.rateForPeriod(organizationId, {
        from: period.previousFrom,
        to: period.previousTo,
      }),
    ]);
    return { current: ratio(current), previous: ratio(previous) };
  }
}

const DEFAULT_RANGE: DashboardRange = 'year';
const FLAT: PeriodChange = { direction: 'flat', percent: null, improved: null };

/**
 * A card from two figures. A null CURRENT is the empty state US-DASH-08 asks
 * for — the value is genuinely unknown, so no change is claimed either.
 */
function kpi(
  current: number | null,
  previous: number | null,
  options: { higherIsBetter?: boolean } = {},
): Kpi {
  if (current === null) return { value: null, change: FLAT };
  return {
    value: current,
    change: comparePeriod(current, previous ?? 0, options),
  };
}

/** A percentage, or null when nobody was expected — never a misleading 0%. */
function ratio(rate: { admitted: number; expected: number }): number | null {
  if (rate.expected === 0) return null;
  return round1((rate.admitted / rate.expected) * PERCENT);
}

/** Largest share first, each as a percentage of the registrations total. */
function toSlices(
  mix: { ticketTypeName: string; count: number }[],
  total: number,
): TierSlice[] {
  return [...mix]
    .sort((a, b) => b.count - a.count)
    .map((tier) => ({
      ...tier,
      percent: total === 0 ? 0 : round1((tier.count / total) * PERCENT),
    }));
}

const round1 = (n: number) => Math.round(n * 10) / 10;
