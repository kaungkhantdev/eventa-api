import { DomainException } from '../../common/errors/domain.exception';
import { RegistrationsReportService } from './registrations-report.service';
import type {
  RegistrationReportPort,
  RegistrationSplitPage,
  RegistrationSplitQuery,
  RegistrationTotals,
  RegistrationWindow,
} from './ports/registration-report.port';

/**
 * The registrations report (US-RPT-08).
 *
 * The service owns the window, the paging defaults and the shape handed back;
 * the split itself comes from RegistrationStats through the port, so nothing
 * here reads an orders table.
 */

const NOW = new Date('2026-07-19T11:40:00.000Z');

/** Bangkok midnight opening the given calendar day. */
const bkkMidnight = (day: string) => new Date(`${day}T00:00:00.000+07:00`);
const ORG = 42;

const row = (over: Partial<RegistrationSplitPage['rows'][number]> = {}) => ({
  eventId: 'e1',
  eventName: 'Tech Summit 2026',
  startAt: new Date('2026-07-18T02:00:00.000Z'),
  confirmed: 400,
  pending: 12,
  waitlisted: 8,
  cancelled: 5,
  rejected: 2,
  total: 427,
  ...over,
});

const NO_SPLIT = {
  confirmed: 0,
  pending: 0,
  waitlisted: 0,
  cancelled: 0,
  rejected: 0,
  total: 0,
};

function portReturning(
  page: Partial<RegistrationSplitPage> = {},
  before: Partial<RegistrationTotals> = {},
) {
  const asked: RegistrationSplitQuery[] = [];
  const windows: RegistrationWindow[] = [];
  const port: RegistrationReportPort = {
    ticketMix: () => Promise.resolve([]),
    totalsFor: (_org: number, window: RegistrationWindow) => {
      windows.push(window);
      return Promise.resolve({ ...NO_SPLIT, ...before });
    },
    splitByEvent: (_org: number, query: RegistrationSplitQuery) => {
      asked.push(query);
      return Promise.resolve({
        rows: [row()],
        matchedEvents: 1,
        totals: {
          confirmed: 400,
          pending: 12,
          waitlisted: 8,
          cancelled: 5,
          rejected: 2,
          total: 427,
        },
        ...page,
      });
    },
  };
  return { port, asked, windows };
}

const serviceWith = (port: RegistrationReportPort) =>
  new RegistrationsReportService(port, { now: () => NOW });

describe('RegistrationsReportService', () => {
  describe('the window it asks for', () => {
    it('defaults to a year when no dates are given', async () => {
      const { port, asked } = portReturning();
      await serviceWith(port).load(ORG, {});
      // 365 days back from the end of today, Bangkok.
      expect(asked[0].from).toEqual(bkkMidnight('2025-07-20'));
    });

    it('passes the requested window straight through', async () => {
      const { port, asked } = portReturning();
      await serviceWith(port).load(ORG, {
        from: '2026-07-01',
        to: '2026-07-07',
      });
      expect(asked[0].from).toEqual(bkkMidnight('2026-07-01'));
      // Exclusive, so the whole of the 7th is inside the window.
      expect(asked[0].to).toEqual(bkkMidnight('2026-07-08'));
    });

    it('refuses a backwards window before asking for any data', async () => {
      const { port, asked } = portReturning();
      await expect(
        serviceWith(port).load(ORG, { from: '2026-07-07', to: '2026-07-01' }),
      ).rejects.toThrow(DomainException);
      expect(asked).toHaveLength(0);
    });

    it('says when it trimmed an over-long span, rather than trimming silently', async () => {
      const { port } = portReturning();
      const view = await serviceWith(port).load(ORG, {
        from: '2022-01-01',
        to: '2026-07-19',
      });
      expect(view.period.trimmed).toBe(true);
    });
  });

  describe('paging', () => {
    it('asks for the first page at the default size when none is given', async () => {
      const { port, asked } = portReturning();
      await serviceWith(port).load(ORG, {});
      expect(asked[0].page).toBe(1);
      expect(asked[0].limit).toBe(20);
    });

    it('honours an explicit page and size', async () => {
      const { port, asked } = portReturning();
      await serviceWith(port).load(ORG, { page: 3, limit: 50 });
      expect(asked[0].page).toBe(3);
      expect(asked[0].limit).toBe(50);
    });
  });

  describe('what it hands back', () => {
    it('reports the totals the owner computed, not the visible page', async () => {
      // The tiles have to match the overview for the same scope, so they are
      // summed across the filter — page two must not report page two's sum.
      const { port } = portReturning({
        rows: [row({ confirmed: 1 })],
        matchedEvents: 40,
      });
      const view = await serviceWith(port).load(ORG, {});
      expect(view.totals.confirmed).toBe(400);
      expect(view.totals.total).toBe(427);
    });

    it('carries every state, so the parts sum to the whole', async () => {
      const { port } = portReturning();
      const view = await serviceWith(port).load(ORG, {});
      const { confirmed, pending, waitlisted, cancelled, rejected, total } =
        view.totals;
      expect(confirmed + pending + waitlisted + cancelled + rejected).toBe(
        total,
      );
    });

    it('pages over events matched, not over rows returned', async () => {
      const { port } = portReturning({ matchedEvents: 40 });
      const view = await serviceWith(port).load(ORG, {});
      expect(view.matchedEvents).toBe(40);
    });

    it('answers a filter that matches nothing with zeros, not an error', async () => {
      // US-RPT-02: an empty match is a friendly empty report, never a failure.
      const { port } = portReturning({
        rows: [],
        matchedEvents: 0,
        totals: {
          confirmed: 0,
          pending: 0,
          waitlisted: 0,
          cancelled: 0,
          rejected: 0,
          total: 0,
        },
      });
      const view = await serviceWith(port).load(ORG, { eventId: 'nope' });
      expect(view.rows).toEqual([]);
      expect(view.totals.total).toBe(0);
    });
  });

  describe('against the previous period (US-RPT-02)', () => {
    it('compares the tiles with the window immediately before this one', async () => {
      const { port, windows } = portReturning(
        {},
        { confirmed: 200, total: 300 },
      );
      await serviceWith(port).load(ORG, {
        from: '2026-07-08',
        to: '2026-07-14',
      });

      expect(windows[0].from).toEqual(bkkMidnight('2026-07-01'));
      expect(windows[0].to).toEqual(bkkMidnight('2026-07-08'));
    });

    it('reads more confirmed registrations as an improvement', async () => {
      const { port } = portReturning({}, { confirmed: 200 });
      const view = await serviceWith(port).load(ORG, {});
      expect(view.changes.confirmed).toMatchObject({
        direction: 'up',
        percent: 100,
        improved: true,
      });
    });

    it('reads FEWER cancellations as an improvement', async () => {
      // Down in sign, better in meaning: a cancellation is a registration lost.
      const { port } = portReturning({}, { cancelled: 20 });
      const view = await serviceWith(port).load(ORG, {});
      expect(view.changes.cancelled).toMatchObject({
        direction: 'down',
        improved: true,
      });
    });

    it('reads more rejections as a warning', async () => {
      const { port } = portReturning({}, { rejected: 1 });
      expect(
        (await serviceWith(port).load(ORG, {})).changes.rejected.improved,
      ).toBe(false);
    });

    it('claims no percentage against a period with nothing in it', async () => {
      // 0 → 400 is "new", not "+40,000%".
      const { port } = portReturning();
      const view = await serviceWith(port).load(ORG, {});
      expect(view.changes.confirmed).toMatchObject({
        direction: 'up',
        percent: null,
      });
    });

    it('compares over the whole filter, not the page being shown', async () => {
      const { port, windows } = portReturning({}, { total: 300 });
      await serviceWith(port).load(ORG, { page: 3, limit: 5 });
      // One previous-window call, unpaged: the tiles must not move as the
      // reader pages through the rows beneath them.
      expect(windows).toHaveLength(1);
      expect(windows[0]).not.toHaveProperty('page');
    });
  });
});
