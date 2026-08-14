import { Permission } from '../../common/decorators/require-permissions.decorator';
import type { Clock } from '../../common/time/clock';
import type { PermissionsService } from '../access/permissions.service';
import type { AuthContext } from '../auth/auth.types';
import { DashboardAnalyticsService } from './dashboard-analytics.service';
import type { RegistrationInsightsPort } from './ports/registration-insights.port';
import type { RevenueInsightsPort } from './ports/revenue-insights.port';
import type {
  CheckInInsightsPort,
  EventInsightsPort,
  InventoryInsightsPort,
} from './ports/operations-insights.port';

const ORG = 7;
const NOW = new Date('2026-08-07T09:00:00Z');
const BAHT = 100;

const auth: AuthContext = {
  userId: 'u-1',
  organizationId: ORG,
  sessionId: 's-1',
  persona: 'admin',
};

const row = {
  orderId: 'o-1',
  attendeeName: 'Anan Suksawat',
  eventName: 'Bangkok Tech Week',
  ticketTypeName: 'General',
  totalSatang: 1_880 * BAHT,
  paymentStatus: 'paid',
  registeredAt: new Date('2026-08-07T08:00:00Z'),
};

describe('DashboardAnalyticsService (US-DASH-08/09/12)', () => {
  let registrations: jest.Mocked<RegistrationInsightsPort>;
  let revenue: jest.Mocked<RevenueInsightsPort>;
  let events: jest.Mocked<EventInsightsPort>;
  let checkIns: jest.Mocked<CheckInInsightsPort>;
  let inventory: jest.Mocked<InventoryInsightsPort>;
  let permissions: jest.Mocked<PermissionsService>;
  let service: DashboardAnalyticsService;

  beforeEach(() => {
    registrations = {
      totalsForPeriod: jest
        .fn()
        .mockResolvedValue({ current: 150, previous: 100 }),
      recent: jest.fn().mockResolvedValue([row]),
      tierMix: jest
        .fn()
        .mockResolvedValue([{ ticketTypeName: 'General', count: 150 }]),
      countSince: jest.fn(),
      countAwaitingDecision: jest.fn(),
    };
    revenue = {
      totalsForPeriod: jest
        .fn()
        .mockResolvedValue({ current: 50_000 * BAHT, previous: 40_000 * BAHT }),
      trend: jest
        .fn()
        .mockResolvedValue([{ at: NOW, netSatang: 50_000 * BAHT }]),
      countDeclined: jest.fn(),
    };
    events = {
      reach: jest
        .fn()
        .mockResolvedValue({ upcoming: 3, capacityFilledPercent: 62.5 }),
    };
    checkIns = {
      rateForPeriod: jest
        .fn()
        .mockResolvedValue({ admitted: 80, expected: 100 }),
    };
    inventory = {
      countSellingOut: jest.fn(),
      sellingFast: jest.fn().mockResolvedValue([
        {
          ticketTypeId: 't-1',
          ticketTypeName: 'VIP',
          eventId: 'e-1',
          eventName: 'Bangkok Tech Week',
          remaining: 3,
          total: 100,
        },
      ]),
    };
    permissions = {
      getFor: jest
        .fn()
        .mockResolvedValue([Permission.regView, Permission.finView]),
    } as unknown as jest.Mocked<PermissionsService>;
    const clock: Clock = { now: () => NOW };
    service = new DashboardAnalyticsService(
      registrations,
      revenue,
      events,
      checkIns,
      inventory,
      permissions,
      clock,
    );
  });

  describe('the KPI cards (US-DASH-08)', () => {
    it('reports registrations with how they moved', async () => {
      const view = await service.load(auth, {});
      expect(view.kpis.registrations).toMatchObject({
        value: 150,
        change: { direction: 'up', percent: 50, improved: true },
      });
    });

    it('reports revenue, upcoming events, check-in rate and capacity', async () => {
      const view = await service.load(auth, {});
      expect(view.kpis.revenueSatang?.value).toBe(50_000 * BAHT);
      expect(view.kpis.upcomingEvents.value).toBe(3);
      expect(view.kpis.checkInRate.value).toBe(80);
      expect(view.kpis.capacityFilled.value).toBe(62.5);
    });

    it('flags a FALLING check-in rate as a worsening, not a rise', async () => {
      checkIns.rateForPeriod
        .mockResolvedValueOnce({ admitted: 60, expected: 100 })
        .mockResolvedValueOnce({ admitted: 90, expected: 100 });
      const view = await service.load(auth, {});
      expect(view.kpis.checkInRate.change.direction).toBe('down');
      expect(view.kpis.checkInRate.change.improved).toBe(false);
    });

    it('shows a neutral empty state rather than a misleading 0% rate', async () => {
      // Nobody was expected, so there is no rate — not "0% turned up".
      checkIns.rateForPeriod.mockResolvedValue({ admitted: 0, expected: 0 });
      const view = await service.load(auth, {});
      expect(view.kpis.checkInRate.value).toBeNull();
    });

    it('withholds revenue while every other card renders normally', async () => {
      permissions.getFor.mockResolvedValue([Permission.regView]);
      const view = await service.load(auth, {});
      expect(view.kpis.revenueSatang).toBeNull();
      expect(view.kpis.registrations.value).toBe(150);
      expect(view.kpis.upcomingEvents.value).toBe(3);
    });
  });

  describe('the revenue trend (US-DASH-09)', () => {
    it('defaults to the yearly view', async () => {
      const view = await service.load(auth, {});
      expect(view.revenue?.range).toBe('year');
    });

    it('switches range without changing anything else about the shape', async () => {
      const view = await service.load(auth, { range: 'week' });
      expect(view.revenue?.range).toBe('week');
      expect(view.revenue?.points).toHaveLength(1);
    });

    it('agrees with the revenue KPI for the same period', async () => {
      // US-DASH-09's note: for the yearly view the two must match.
      const view = await service.load(auth, {});
      expect(view.revenue?.totalSatang).toBe(view.kpis.revenueSatang?.value);
    });

    it('is a zero result with a neutral change when the period is empty', async () => {
      revenue.totalsForPeriod.mockResolvedValue({ current: 0, previous: 0 });
      revenue.trend.mockResolvedValue([]);
      const view = await service.load(auth, {});
      expect(view.revenue?.totalSatang).toBe(0);
      expect(view.revenue?.change.direction).toBe('flat');
      expect(view.revenue?.change.percent).toBeNull();
    });

    it('is not shown AT ALL without finance access, and is never queried', async () => {
      permissions.getFor.mockResolvedValue([Permission.regView]);
      const view = await service.load(auth, {});
      expect(view.revenue).toBeNull();
      expect(revenue.trend).not.toHaveBeenCalled();
      expect(revenue.totalsForPeriod).not.toHaveBeenCalled();
    });
  });

  describe('the recent-registrations table (US-DASH-12)', () => {
    it('lists newest first with attendee, event, amount, status and time', async () => {
      const view = await service.load(auth, {});
      expect(view.recent[0]).toMatchObject({
        attendeeName: 'Anan Suksawat',
        eventName: 'Bangkok Tech Week',
        totalSatang: 1_880 * BAHT,
        paymentStatus: 'paid',
      });
    });

    it('hides the amount but keeps the rest without finance access', async () => {
      permissions.getFor.mockResolvedValue([Permission.regView]);
      const view = await service.load(auth, {});
      expect(view.recent[0].totalSatang).toBeNull();
      expect(view.recent[0].eventName).toBe('Bangkok Tech Week');
      expect(view.recent[0].paymentStatus).toBe('paid');
    });

    it('is empty, and never queried, without permission to see attendees', async () => {
      permissions.getFor.mockResolvedValue([Permission.finView]);
      const view = await service.load(auth, {});
      expect(view.recent).toEqual([]);
      expect(registrations.recent).not.toHaveBeenCalled();
    });
  });

  describe('tickets selling fast (US-DASH-11)', () => {
    it('lists the tiers running low, with the event they belong to', async () => {
      const view = await service.load(auth, {});
      expect(view.sellingFast).toEqual([
        {
          ticketTypeId: 't-1',
          ticketTypeName: 'VIP',
          eventId: 'e-1',
          eventName: 'Bangkok Tech Week',
          remaining: 3,
          total: 100,
        },
      ]);
    });

    // The panel is a preview with a "Manage" link, not the inventory list.
    it('asks for only as many as the panel shows', async () => {
      await service.load(auth, {});
      expect(inventory.sellingFast).toHaveBeenCalledWith(ORG, 3);
    });

    it('is simply empty when nothing is close to selling out', async () => {
      inventory.sellingFast.mockResolvedValue([]);
      const view = await service.load(auth, {});
      expect(view.sellingFast).toEqual([]);
    });
  });

  describe('agreeing with itself (US-DASH-13)', () => {
    it('makes the tier mix total the registrations KPI', async () => {
      const view = await service.load(auth, {});
      const mixTotal = view.tierMix.reduce((sum, t) => sum + t.count, 0);
      expect(mixTotal).toBe(view.kpis.registrations.value);
    });

    it('gives each tier its share as a percentage of that total', async () => {
      registrations.tierMix.mockResolvedValue([
        { ticketTypeName: 'General', count: 90 },
        { ticketTypeName: 'VIP', count: 60 },
      ]);
      const view = await service.load(auth, {});
      expect(view.tierMix[0]).toMatchObject({ count: 90, percent: 60 });
      expect(view.tierMix[1]).toMatchObject({ count: 60, percent: 40 });
    });

    it('orders the mix largest share first', async () => {
      registrations.tierMix.mockResolvedValue([
        { ticketTypeName: 'Early', count: 10 },
        { ticketTypeName: 'General', count: 140 },
      ]);
      const view = await service.load(auth, {});
      expect(view.tierMix.map((t) => t.ticketTypeName)).toEqual([
        'General',
        'Early',
      ]);
    });

    it('stamps when it was generated', async () => {
      const view = await service.load(auth, {});
      expect(view.generatedAt).toEqual(NOW);
    });
  });
});
