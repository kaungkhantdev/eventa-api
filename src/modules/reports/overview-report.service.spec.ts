import { Permission } from '../../common/decorators/require-permissions.decorator';
import type { PermissionsService } from '../access/permissions.service';
import type { AuthContext } from '../auth/auth.types';
import { OverviewReportService } from './overview-report.service';
import type { AttendanceReportPort } from './ports/attendance-report.port';
import type { IncomeReportPort } from './ports/income-report.port';
import type { RegistrationReportPort } from './ports/registration-report.port';

/**
 * Workspace health at a glance (US-RPT-01).
 *
 * Five tiles and a chart, each built from a figure for this period and the same
 * figure for the one before it. What is tested here is what the tiles MEAN:
 * which way is "better", when a comparison is honest, and which of them a
 * caller without finance access never sees at all.
 */

const ORG = 42;
const NOW = new Date('2026-07-19T11:40:00.000Z');
const BAHT = 100;

const auth: AuthContext = {
  userId: 'u-1',
  organizationId: ORG,
  sessionId: 's-1',
  persona: 'admin',
};

/** 4% of gross refunded, 400 seats sold at ฿250 each. */
const INCOME_NOW = {
  grossSatang: 100_000 * BAHT,
  vatSatang: 0,
  refundsSatang: 4_000 * BAHT,
  feesSatang: 0,
  netSatang: 96_000 * BAHT,
  settledSatang: 96_000 * BAHT,
  paidSeats: 400,
};

/** 6% refunded, 250 seats at ฿200. */
const INCOME_BEFORE = {
  grossSatang: 50_000 * BAHT,
  vatSatang: 0,
  refundsSatang: 3_000 * BAHT,
  feesSatang: 0,
  netSatang: 47_000 * BAHT,
  settledSatang: 47_000 * BAHT,
  paidSeats: 250,
};

const split = (confirmed: number) => ({
  confirmed,
  pending: 12,
  waitlisted: 3,
  cancelled: 5,
  rejected: 1,
  total: confirmed + 21,
});

const attendance = (registered: number, checkedIn: number) => ({
  registered,
  checkedIn,
  checkedInAll: checkedIn,
  onTime: checkedIn,
});

describe('OverviewReportService (US-RPT-01)', () => {
  let income: jest.Mocked<IncomeReportPort>;
  let registrations: jest.Mocked<RegistrationReportPort>;
  let attendancePort: jest.Mocked<AttendanceReportPort>;
  let permissions: jest.Mocked<PermissionsService>;
  let service: OverviewReportService;

  beforeEach(() => {
    income = {
      incomeByEvent: jest.fn(),
      // First call is this period, second is the one before it.
      incomeTotals: jest
        .fn()
        .mockResolvedValueOnce(INCOME_NOW)
        .mockResolvedValueOnce(INCOME_BEFORE),
      netByDay: jest.fn().mockResolvedValue([]),
    };
    registrations = {
      splitByEvent: jest.fn(),
      totalsFor: jest
        .fn()
        .mockResolvedValueOnce(split(400))
        .mockResolvedValueOnce(split(350)),
      ticketMix: jest.fn().mockResolvedValue([
        { ticketTypeName: 'General Admission', seats: 300 },
        { ticketTypeName: 'VIP', seats: 100 },
      ]),
    };
    attendancePort = {
      attendanceByEvent: jest.fn(),
      totalsFor: jest
        .fn()
        .mockResolvedValueOnce(attendance(400, 320))
        .mockResolvedValueOnce(attendance(300, 255)),
    };
    permissions = {
      getFor: jest
        .fn()
        .mockResolvedValue([Permission.regView, Permission.finView]),
    } as unknown as jest.Mocked<PermissionsService>;
    service = new OverviewReportService(
      income,
      registrations,
      attendancePort,
      permissions,
      { now: () => NOW },
    );
  });

  describe('the five tiles', () => {
    it('counts registrations as confirmed seats, not every order state', async () => {
      // Pending, cancelled and rejected seats are not registrations the
      // organizer holds; counting them would make the tile RISE as people
      // withdraw.
      const view = await service.load(auth, {});
      expect(view.kpis.registrations.value).toBe(400);
    });

    it('reports revenue as the income report’s net, unchanged', async () => {
      // US-RPT-01's note: it must equal the Income report's Net for the same
      // scope. It does so by being the same number, not by agreeing arithmetic.
      const view = await service.load(auth, {});
      expect(view.kpis.revenueSatang?.value).toBe(INCOME_NOW.netSatang);
    });

    it('prices the average ticket over the seats that were paid for', async () => {
      // ฿100,000 across 400 seats: ฿250 a ticket, VAT included, which is what
      // the buyer was actually charged.
      const view = await service.load(auth, {});
      expect(view.kpis.averageTicketSatang?.value).toBe(250 * BAHT);
    });

    it('rates attendance over those expected at events that have started', async () => {
      const view = await service.load(auth, {});
      expect(view.kpis.attendanceRate.value).toBe(80);
    });

    it('rates refunds against the money taken', async () => {
      const view = await service.load(auth, {});
      expect(view.kpis.refundRate?.value).toBe(4);
    });
  });

  describe('direction of good', () => {
    it('treats rising revenue as an improvement', async () => {
      const view = await service.load(auth, {});
      expect(view.kpis.revenueSatang?.change).toMatchObject({
        direction: 'up',
        improved: true,
      });
    });

    it('treats a FALLING refund rate as an improvement', async () => {
      // 4% against 6%: down in sign, good in meaning. The whole reason the
      // comparison takes a direction rather than reading the sign.
      const view = await service.load(auth, {});
      expect(view.kpis.refundRate?.change).toMatchObject({
        direction: 'down',
        improved: true,
      });
    });

    it('treats a falling attendance rate as a warning', async () => {
      attendancePort.totalsFor = jest
        .fn()
        .mockResolvedValueOnce(attendance(400, 200))
        .mockResolvedValueOnce(attendance(300, 255));
      const view = await service.load(auth, {});
      expect(view.kpis.attendanceRate.change).toMatchObject({
        direction: 'down',
        improved: false,
      });
    });
  });

  describe('when a figure has no honest comparison', () => {
    it('claims no change where the previous period had no rate at all', async () => {
      // Nothing ran last period, so there is no attendance to have moved from —
      // "up from 0%" would invent a baseline that never existed.
      attendancePort.totalsFor = jest
        .fn()
        .mockResolvedValueOnce(attendance(400, 320))
        .mockResolvedValueOnce(attendance(0, 0));
      const view = await service.load(auth, {});
      expect(view.kpis.attendanceRate.change).toEqual({
        direction: 'flat',
        percent: null,
        improved: null,
      });
    });

    it('reports no attendance rate when nobody was expected', async () => {
      attendancePort.totalsFor = jest.fn().mockResolvedValue(attendance(0, 0));
      const view = await service.load(auth, {});
      expect(view.kpis.attendanceRate.value).toBeNull();
    });

    it('reports no average ticket when nothing was sold', async () => {
      income.incomeTotals = jest
        .fn()
        .mockResolvedValue({ ...INCOME_NOW, grossSatang: 0, paidSeats: 0 });
      const view = await service.load(auth, {});
      expect(view.kpis.averageTicketSatang?.value).toBeNull();
    });

    it('reports no refund rate when no money was taken', async () => {
      income.incomeTotals = jest
        .fn()
        .mockResolvedValue({ ...INCOME_NOW, grossSatang: 0 });
      const view = await service.load(auth, {});
      expect(view.kpis.refundRate?.value).toBeNull();
    });

    it('gives a zero total and a neutral change for an empty window', async () => {
      // TC-RPT-02 exactly: no revenue in the last 7 days is ฿0 and "—", never
      // an error and never a percentage off a zero baseline.
      income.incomeTotals = jest.fn().mockResolvedValue({
        ...INCOME_NOW,
        grossSatang: 0,
        netSatang: 0,
        refundsSatang: 0,
        paidSeats: 0,
      });
      const view = await service.load(auth, { range: '7d' });
      expect(view.revenue?.totalSatang).toBe(0);
      expect(view.revenue?.change.percent).toBeNull();
    });
  });

  describe('the revenue trend', () => {
    it('shows the same total as the revenue tile', async () => {
      // One number from one call: US-RPT-01's "headline total" cannot drift from
      // the tile because there is nothing to drift.
      const view = await service.load(auth, {});
      expect(view.revenue?.totalSatang).toBe(view.kpis.revenueSatang?.value);
    });

    it('plots a week day by day', async () => {
      const view = await service.load(auth, { range: '7d' });
      expect(view.revenue?.granularity).toBe('day');
      expect(view.revenue?.points).toHaveLength(7);
    });

    it('plots a year month by month', async () => {
      const view = await service.load(auth, { range: 'year' });
      expect(view.revenue?.granularity).toBe('month');
      expect(view.revenue?.points.length).toBeGreaterThanOrEqual(12);
    });

    it('recomputes the window when the range changes', async () => {
      await service.load(auth, { range: '7d' });
      expect(view7dDays(income)).toBe(7);
    });
  });

  describe('without finance access', () => {
    beforeEach(() => {
      permissions.getFor = jest.fn().mockResolvedValue([Permission.regView]);
    });

    it('withholds every money tile rather than zeroing it', async () => {
      const view = await service.load(auth, {});
      expect(view.kpis.revenueSatang).toBeNull();
      expect(view.kpis.averageTicketSatang).toBeNull();
      expect(view.kpis.refundRate).toBeNull();
      expect(view.revenue).toBeNull();
    });

    it('never reads the money at all', async () => {
      // Withheld at the source, not hidden at the edge: an unauthorized caller's
      // request must not put the figures into the process in the first place.
      await service.load(auth, {});
      expect(income.incomeTotals).not.toHaveBeenCalled();
      expect(income.netByDay).not.toHaveBeenCalled();
    });

    it('still reports the registration and attendance tiles', async () => {
      const view = await service.load(auth, {});
      expect(view.kpis.registrations.value).toBe(400);
      expect(view.kpis.attendanceRate.value).toBe(80);
    });
  });

  describe('the filter', () => {
    it('passes the event and search through to every port', async () => {
      await service.load(auth, { eventId: 'e-1', q: 'jazz' });
      for (const call of [
        income.incomeTotals,
        registrations.totalsFor,
        attendancePort.totalsFor,
      ]) {
        expect(call).toHaveBeenCalledWith(
          ORG,
          expect.objectContaining({ eventId: 'e-1', search: 'jazz' }),
        );
      }
    });

    it('compares against a previous window that never overlaps this one', async () => {
      await service.load(auth, { range: '30d' });
      const [[, current], [, previous]] = income.incomeTotals.mock.calls;
      expect(previous.to.getTime()).toBe(current.from.getTime());
    });
  });

  describe('the ticket-type mix (US-RPT-03)', () => {
    it('gives each type its share of the mix', async () => {
      const view = await service.load(auth, {});
      expect(view.ticketMix).toEqual([
        { ticketTypeName: 'General Admission', seats: 300, percent: 75 },
        { ticketTypeName: 'VIP', seats: 100, percent: 25 },
      ]);
    });

    it('makes the shares add up to the whole', async () => {
      // The story's own requirement for the donut.
      const view = await service.load(auth, {});
      const total = view.ticketMix.reduce(
        (sum, slice) => sum + slice.percent,
        0,
      );
      expect(total).toBeCloseTo(100, 1);
    });

    it('returns no slices at all when nothing was sold', async () => {
      // An empty donut, not a ring of zero-width slices.
      registrations.ticketMix = jest.fn().mockResolvedValue([]);
      expect((await service.load(auth, {})).ticketMix).toEqual([]);
    });

    it('does not read the mix for a member without registration access', async () => {
      permissions.getFor = jest.fn().mockResolvedValue([Permission.finView]);
      await service.load(auth, {});
      expect(registrations.ticketMix).not.toHaveBeenCalled();
    });
  });
});

/** How many days the trend's own window covered, from the port's first call. */
function view7dDays(income: jest.Mocked<IncomeReportPort>): number {
  const [, window] = income.netByDay.mock.calls[0];
  return Math.round(
    (window.to.getTime() - window.from.getTime()) / (24 * 60 * 60 * 1000),
  );
}
