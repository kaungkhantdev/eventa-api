import { Permission } from '../../common/decorators/require-permissions.decorator';
import type { Clock } from '../../common/time/clock';
import type { PermissionsService } from '../access/permissions.service';
import type { AuthContext } from '../auth/auth.types';
import { ALL_CAUGHT_UP } from './alerts';
import { DashboardHomeService } from './dashboard-home.service';
import type { RegistrationInsightsPort } from './ports/registration-insights.port';
import type { RevenueInsightsPort } from './ports/revenue-insights.port';
import type { InventoryInsightsPort } from './ports/operations-insights.port';

const ORG = 7;
/** 16:00 Bangkok on a Friday. */
const NOW = new Date('2026-08-07T09:00:00Z');

const auth: AuthContext = {
  userId: 'u-1',
  organizationId: ORG,
  sessionId: 's-1',
  persona: 'admin',
};

const recent = {
  orderId: 'o-1',
  attendeeName: 'Anan Suksawat',
  eventName: 'Bangkok Tech Week',
  ticketTypeName: 'General',
  totalSatang: 188_000,
  paymentStatus: 'paid',
  registeredAt: new Date('2026-08-07T08:00:00Z'),
};

describe('DashboardHomeService (US-DASH-01/02/06)', () => {
  let registrations: jest.Mocked<RegistrationInsightsPort>;
  let revenue: jest.Mocked<RevenueInsightsPort>;
  let inventory: jest.Mocked<InventoryInsightsPort>;
  let permissions: jest.Mocked<PermissionsService>;
  let service: DashboardHomeService;

  beforeEach(() => {
    registrations = {
      countSince: jest.fn().mockResolvedValue(4),
      recent: jest.fn().mockResolvedValue([recent]),
      countAwaitingDecision: jest.fn().mockResolvedValue(2),
      totalsForPeriod: jest.fn(),
      tierMix: jest.fn(),
    };
    revenue = {
      countDeclined: jest.fn().mockResolvedValue(1),
      totalsForPeriod: jest.fn(),
      trend: jest.fn(),
    };
    inventory = { countSellingOut: jest.fn().mockResolvedValue(0) };
    permissions = {
      getFor: jest
        .fn()
        .mockResolvedValue([
          Permission.regView,
          Permission.finView,
          Permission.evCreate,
        ]),
    } as unknown as jest.Mocked<PermissionsService>;
    const clock: Clock = { now: () => NOW };
    service = new DashboardHomeService(
      registrations,
      revenue,
      inventory,
      permissions,
      clock,
    );
  });

  describe('the greeting (US-DASH-01)', () => {
    it('greets by name in Bangkok time, in the caller’s language', async () => {
      const home = await service.load(auth, 'Anan', 'en');
      expect(home.greeting).toBe('Good afternoon, Anan');
    });

    it('greets in Thai when asked', async () => {
      const home = await service.load(auth, 'อนันต์', 'th');
      expect(home.greeting).toContain('สวัสดี');
    });
  });

  describe("today's registrations (US-DASH-02)", () => {
    it('counts from the start of the BANGKOK day, not 24 hours ago', async () => {
      await service.load(auth, 'Anan', 'en');
      const [, since] = registrations.countSince.mock.calls[0];
      // 16:00 Bangkok on 7 Aug → midnight Bangkok = 17:00 UTC on 6 Aug.
      expect(since.toISOString()).toBe('2026-08-06T17:00:00.000Z');
    });

    it('previews the newest sign-ups with who, what and when', async () => {
      const home = await service.load(auth, 'Anan', 'en');
      expect(home.today.count).toBe(4);
      expect(home.today.recent[0]).toMatchObject({
        attendeeName: 'Anan Suksawat',
        eventName: 'Bangkok Tech Week',
        ticketTypeName: 'General',
      });
    });

    it('says so plainly when nobody has registered yet today', async () => {
      registrations.countSince.mockResolvedValue(0);
      registrations.recent.mockResolvedValue([]);
      const home = await service.load(auth, 'Anan', 'en');
      expect(home.today.count).toBe(0);
      expect(home.today.emptyMessage).toMatch(/no registrations yet today/i);
    });

    it('withholds the panel entirely from someone who may not see attendees', async () => {
      // Attendee names are personal data (US-DASH-02's note).
      permissions.getFor.mockResolvedValue([Permission.evCreate]);
      const home = await service.load(auth, 'Anan', 'en');
      expect(home.today).toBeNull();
      expect(registrations.recent).not.toHaveBeenCalled();
      expect(registrations.countSince).not.toHaveBeenCalled();
    });

    it('masks the amount from someone without finance access', async () => {
      permissions.getFor.mockResolvedValue([Permission.regView]);
      const home = await service.load(auth, 'Anan', 'en');
      // Hidden, never zero (US-DASH-13).
      expect(home.today?.recent[0].totalSatang).toBeNull();
      expect(home.today?.recent[0].attendeeName).toBe('Anan Suksawat');
    });
  });

  describe('alerts (US-DASH-06)', () => {
    it('raises the declined payment first, then the approvals', async () => {
      const home = await service.load(auth, 'Anan', 'en');
      expect(home.alerts.alerts.map((a) => a.kind)).toEqual([
        'declined_payments',
        'pending_approvals',
      ]);
    });

    it('never even asks about money when finance is withheld', async () => {
      permissions.getFor.mockResolvedValue([Permission.regView]);
      const home = await service.load(auth, 'Anan', 'en');
      expect(revenue.countDeclined).not.toHaveBeenCalled();
      expect(home.alerts.alerts.map((a) => a.kind)).toEqual([
        'pending_approvals',
      ]);
    });

    it('is caught up when the only outstanding thing is one you may not see', async () => {
      permissions.getFor.mockResolvedValue([Permission.regView]);
      registrations.countAwaitingDecision.mockResolvedValue(0);
      const home = await service.load(auth, 'Anan', 'en');
      expect(home.alerts.emptyMessage).toBe(ALL_CAUGHT_UP);
    });
  });

  it('stamps when it was generated, so the UI can show freshness', async () => {
    const home = await service.load(auth, 'Anan', 'en');
    expect(home.generatedAt).toEqual(NOW);
  });
});
