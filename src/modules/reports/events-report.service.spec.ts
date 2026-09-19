import { Permission } from '../../common/decorators/require-permissions.decorator';
import type { PermissionsService } from '../access/permissions.service';
import type { AuthContext } from '../auth/auth.types';
import { EventsReportService } from './events-report.service';
import type {
  EventPerformancePage,
  EventPerformancePort,
  EventPerformanceRow,
} from './ports/event-performance.port';
import type { IncomeReportPort } from './ports/income-report.port';

/**
 * Event performance, ranked (US-RPT-04).
 *
 * The ranking and the counts are SQL's, and the e2e proves them. What is tested
 * here is the service's own job: turning counts into an attendance rate that
 * tells the truth about an event that has not happened, and withholding revenue
 * from a reader who may not see money.
 */

const ORG = 11;
const NOW = new Date('2026-07-19T11:40:00.000Z');

const auth: AuthContext = {
  userId: 'u-1',
  organizationId: ORG,
  sessionId: 's-1',
  persona: 'admin',
};

const row = (over: Partial<EventPerformanceRow> = {}): EventPerformanceRow => ({
  eventId: 'e-1',
  eventName: 'Tech Summit 2026',
  startAt: new Date('2026-07-10T02:00:00.000Z'),
  venueName: 'BITEC',
  city: 'Bangkok',
  isOnline: false,
  lifecycle: 'completed',
  registrations: 400,
  ticketed: 400,
  checkedIn: 320,
  ...over,
});

function portsFor(page: Partial<EventPerformancePage> = {}, net = 824_000) {
  const events: EventPerformancePort = {
    rank: () => Promise.resolve({ rows: [row()], matchedEvents: 1, ...page }),
  };
  const income = {
    netByEvents: jest
      .fn()
      .mockResolvedValue([{ eventId: 'e-1', netSatang: net }]),
  } as unknown as jest.Mocked<IncomeReportPort>;
  return { events, income };
}

function serviceWith(
  ports: ReturnType<typeof portsFor>,
  granted: string[] = [Permission.regView, Permission.finView],
) {
  const permissions = {
    getFor: jest.fn().mockResolvedValue(granted),
  } as unknown as jest.Mocked<PermissionsService>;
  return {
    service: new EventsReportService(ports.events, ports.income, permissions, {
      now: () => NOW,
    }),
    income: ports.income,
  };
}

describe('EventsReportService (US-RPT-04)', () => {
  describe('one event’s row', () => {
    it('carries the venue beside the date, as the meta line', async () => {
      const { service } = serviceWith(portsFor());
      const [event] = (await service.load(auth, {})).rows;
      expect(event.venue).toBe('BITEC');
    });

    it('says "Online" where an event has no venue to name', async () => {
      const { service } = serviceWith(
        portsFor({ rows: [row({ isOnline: true, venueName: null })] }),
      );
      expect((await service.load(auth, {})).rows[0].venue).toBe('Online');
    });

    it('leaves the venue unknown rather than inventing one', async () => {
      const { service } = serviceWith(
        portsFor({ rows: [row({ isOnline: false, venueName: null })] }),
      );
      expect((await service.load(auth, {})).rows[0].venue).toBeNull();
    });

    it('rates attendance over the tickets issued for it', async () => {
      const { service } = serviceWith(portsFor());
      expect((await service.load(auth, {})).rows[0].attendanceRate).toBe(80);
    });

    it('reports no attendance rate for an event still to come', async () => {
      // "—", not 0% — the story's own wording. Nobody could have arrived yet.
      const { service } = serviceWith(
        portsFor({
          rows: [row({ lifecycle: 'upcoming', ticketed: 400, checkedIn: 0 })],
        }),
      );
      expect((await service.load(auth, {})).rows[0].attendanceRate).toBeNull();
    });

    it('reports 0% for a finished event nobody attended', async () => {
      const { service } = serviceWith(
        portsFor({ rows: [row({ checkedIn: 0 })] }),
      );
      expect((await service.load(auth, {})).rows[0].attendanceRate).toBe(0);
    });

    it('reports no rate for an event that sold nothing', async () => {
      const { service } = serviceWith(
        portsFor({ rows: [row({ ticketed: 0, checkedIn: 0 })] }),
      );
      expect((await service.load(auth, {})).rows[0].attendanceRate).toBeNull();
    });

    it('carries the lifecycle the port worked out', async () => {
      const { service } = serviceWith(
        portsFor({ rows: [row({ lifecycle: 'cancelled' })] }),
      );
      expect((await service.load(auth, {})).rows[0].lifecycle).toBe(
        'cancelled',
      );
    });
  });

  describe('revenue', () => {
    it('attaches each event’s net takings to its row', async () => {
      const { service } = serviceWith(portsFor());
      expect((await service.load(auth, {})).rows[0].revenueSatang).toBe(
        824_000,
      );
    });

    it('reports zero for an event that has taken nothing', async () => {
      // A free event really has made ฿0, which is not the same as being
      // forbidden to see the figure.
      const { service, income } = serviceWith(portsFor());
      income.netByEvents = jest.fn().mockResolvedValue([]);
      expect((await service.load(auth, {})).rows[0].revenueSatang).toBe(0);
    });

    it('asks only about the events on this page', async () => {
      const { service, income } = serviceWith(portsFor());
      await service.load(auth, {});
      expect(income.netByEvents).toHaveBeenCalledWith(ORG, ['e-1']);
    });

    it('withholds revenue from a reader without finance access', async () => {
      // Null, never zero: "you may not see this" and "it earned nothing" are
      // different facts (US-RPT-12).
      const { service } = serviceWith(portsFor(), [Permission.regView]);
      expect((await service.load(auth, {})).rows[0].revenueSatang).toBeNull();
    });

    it('never reads the money at all for such a reader', async () => {
      const { service, income } = serviceWith(portsFor(), [Permission.regView]);
      await service.load(auth, {});
      expect(income.netByEvents).not.toHaveBeenCalled();
    });

    it('still ranks and counts everything else for them', async () => {
      const { service } = serviceWith(portsFor(), [Permission.regView]);
      const view = await service.load(auth, {});
      expect(view.rows[0].registrations).toBe(400);
      expect(view.rows[0].attendanceRate).toBe(80);
    });
  });

  describe('the filter', () => {
    it('passes the window, the search and the stage through', async () => {
      const ports = portsFor();
      const rank = jest.spyOn(ports.events, 'rank');
      const { service } = serviceWith(ports);

      await service.load(auth, { q: 'summit', status: 'live', page: 2 });
      expect(rank).toHaveBeenCalledWith(
        ORG,
        expect.objectContaining({
          search: 'summit',
          lifecycle: 'live',
          page: 2,
        }),
      );
    });

    it('answers a filter matching nothing without erroring', async () => {
      const { service } = serviceWith(portsFor({ rows: [], matchedEvents: 0 }));
      const view = await service.load(auth, { q: 'nope' });
      expect(view.rows).toEqual([]);
      expect(view.matchedEvents).toBe(0);
    });

    it('does not ask about revenue when there are no events to ask about', async () => {
      const { service, income } = serviceWith(
        portsFor({ rows: [], matchedEvents: 0 }),
      );
      await service.load(auth, {});
      expect(income.netByEvents).not.toHaveBeenCalled();
    });
  });
});
