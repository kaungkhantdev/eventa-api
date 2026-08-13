import { Injectable } from '@nestjs/common';
import { Permission } from '../../common/decorators/require-permissions.decorator';
import { Clock } from '../../common/time/clock';
import { BANGKOK_OFFSET_MS, DAY_MS } from '../../common/time/bangkok';
import { PermissionsService } from '../access/permissions.service';
import type { AuthContext } from '../auth/auth.types';
import { type AlertsView, buildAlerts } from './alerts';
import { type Language, greetingFor } from './greeting';
import { InventoryInsightsPort } from './ports/operations-insights.port';
import { RegistrationInsightsPort } from './ports/registration-insights.port';
import { RevenueInsightsPort } from './ports/revenue-insights.port';

/** How many sign-ups the home preview shows before "view all". */
const PREVIEW_LIMIT = 5;
const NOTHING_TODAY = 'No registrations yet today.';

export interface TodayFeedItem {
  orderId: string;
  attendeeName: string;
  eventName: string;
  ticketTypeName: string | null;
  /** Null when the caller may not see money — never 0 (US-DASH-13). */
  totalSatang: number | null;
  paymentStatus: string;
  registeredAt: Date;
}

export interface TodayFeed {
  count: number;
  recent: TodayFeedItem[];
  emptyMessage: string | null;
}

export interface HomeView {
  greeting: string;
  /** Null when the caller may not see attendee personal data (US-DASH-02). */
  today: TodayFeed | null;
  alerts: AlertsView;
  generatedAt: Date;
}

/**
 * The daily operations home (US-DASH-01/02/06).
 *
 * Read-only by design: it summarizes and links out, and every alert points at
 * the module that owns the problem and enforces its own rules.
 *
 * Permissions are applied by NOT FETCHING, not by blanking a response. A caller
 * without `regView` never causes a query against sign-ups, and one without
 * `finView` never causes a query about money — so the figure they may not see
 * does not transit this process at all. Where a field must still appear in a
 * shape (an amount on a row they may otherwise read) it is `null` rather than 0,
 * because "you may not see this" and "it was free" are different facts.
 */
@Injectable()
export class DashboardHomeService {
  constructor(
    private readonly registrations: RegistrationInsightsPort,
    private readonly revenue: RevenueInsightsPort,
    private readonly inventory: InventoryInsightsPort,
    private readonly permissions: PermissionsService,
    private readonly clock: Clock,
  ) {}

  async load(
    auth: AuthContext,
    name: string,
    language: Language,
  ): Promise<HomeView> {
    const now = this.clock.now();
    const granted = await this.permissions.getFor(
      auth.organizationId,
      auth.userId,
    );
    const access = {
      registrations: granted.includes(Permission.regView),
      finance: granted.includes(Permission.finView),
    };
    const [today, alerts] = await Promise.all([
      this.todayFeed(auth.organizationId, now, access),
      this.alerts(auth.organizationId, access),
    ]);
    return {
      greeting: greetingFor(now, name, language),
      today,
      alerts,
      generatedAt: now,
    };
  }

  private async todayFeed(
    organizationId: number,
    now: Date,
    access: { registrations: boolean; finance: boolean },
  ): Promise<TodayFeed | null> {
    if (!access.registrations) return null;
    const [count, recent] = await Promise.all([
      this.registrations.countSince(organizationId, startOfBangkokDay(now)),
      this.registrations.recent(organizationId, PREVIEW_LIMIT),
    ]);
    return {
      count,
      recent: recent.map((row) => ({
        ...row,
        totalSatang: access.finance ? row.totalSatang : null,
      })),
      emptyMessage: count === 0 ? NOTHING_TODAY : null,
    };
  }

  private async alerts(
    organizationId: number,
    access: { finance: boolean },
  ): Promise<AlertsView> {
    const [pendingApprovals, declinedPayments, sellingOut] = await Promise.all([
      this.registrations.countAwaitingDecision(organizationId),
      // Not merely hidden afterwards — never asked (US-DASH-13).
      access.finance ? this.revenue.countDeclined(organizationId) : 0,
      this.inventory.countSellingOut(organizationId),
    ]);
    return buildAlerts(
      { pendingApprovals, declinedPayments, sellingOut },
      access,
    );
  }
}

/** Midnight Bangkok on the day of `instant` — where "today" actually starts. */
function startOfBangkokDay(instant: Date): Date {
  const shifted = instant.getTime() + BANGKOK_OFFSET_MS;
  return new Date(Math.floor(shifted / DAY_MS) * DAY_MS - BANGKOK_OFFSET_MS);
}
