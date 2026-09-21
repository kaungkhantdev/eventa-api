import { DomainException } from '../../common/errors/domain.exception';
import { IncomeReportService } from './income-report.service';
import type {
  IncomeQuery,
  IncomeReportPort,
  IncomePage,
  IncomeSummary,
  IncomeWindow,
} from './ports/income-report.port';

/**
 * The income report (US-RPT-05).
 *
 * The arithmetic belongs to Payments and is asserted against a real database in
 * the e2e. What this covers is the service's own job: the window, the paging,
 * and the consistency rule that makes the report reconcile with itself.
 */

const NOW = new Date('2026-07-19T11:40:00.000Z');
const bkkMidnight = (day: string) => new Date(`${day}T00:00:00.000+07:00`);
const ORG = 42;

const money = {
  grossSatang: 107_000,
  vatSatang: 7_000,
  refundsSatang: 10_000,
  feesSatang: 3_000,
  netSatang: 90_000,
  settledSatang: 87_000,
};

const NO_MONEY = {
  grossSatang: 0,
  vatSatang: 0,
  refundsSatang: 0,
  feesSatang: 0,
  netSatang: 0,
  settledSatang: 0,
  paidSeats: 0,
};

function portReturning(
  page: Partial<IncomePage> = {},
  before: Partial<IncomeSummary> = {},
) {
  const asked: IncomeQuery[] = [];
  const windows: IncomeWindow[] = [];
  const port: IncomeReportPort = {
    incomeTotals: (_org: number, window: IncomeWindow) => {
      windows.push(window);
      return Promise.resolve({ ...NO_MONEY, ...before });
    },
    netByDay: () => Promise.resolve([]),
    incomeByEvent: (_org: number, query: IncomeQuery) => {
      asked.push(query);
      return Promise.resolve({
        rows: [
          {
            eventId: 'e1',
            eventName: 'Tech Summit 2026',
            startAt: new Date('2026-07-18T02:00:00.000Z'),
            ...money,
          },
        ],
        matchedEvents: 1,
        totals: { ...money },
        ...page,
      });
    },
  };
  return { port, asked, windows };
}

const serviceWith = (port: IncomeReportPort) =>
  new IncomeReportService(port, { now: () => NOW });

describe('IncomeReportService', () => {
  describe('the window', () => {
    it('defaults to a year', async () => {
      const { port, asked } = portReturning();
      await serviceWith(port).load(ORG, {});
      expect(asked[0].from).toEqual(bkkMidnight('2025-07-20'));
    });

    it('refuses a backwards window before asking Payments for anything', async () => {
      const { port, asked } = portReturning();
      await expect(
        serviceWith(port).load(ORG, { from: '2026-07-07', to: '2026-07-01' }),
      ).rejects.toThrow(DomainException);
      expect(asked).toHaveLength(0);
    });

    it('uses the same resolver every other report does', async () => {
      // Income and registrations filtered to the same days must cover the same
      // instants, or US-RPT-12's cross-report agreement is impossible.
      const { port, asked } = portReturning();
      await serviceWith(port).load(ORG, {
        from: '2026-07-01',
        to: '2026-07-07',
      });
      expect(asked[0].from).toEqual(bkkMidnight('2026-07-01'));
      expect(asked[0].to).toEqual(bkkMidnight('2026-07-08'));
    });
  });

  describe('the figures it reports', () => {
    it('reconciles: net is gross less VAT and refunds', async () => {
      // The definition the dashboard already uses, so the overview agrees.
      const view = await serviceWith(portReturning().port).load(ORG, {});
      const t = view.totals;
      expect(t.grossSatang - t.vatSatang - t.refundsSatang).toBe(t.netSatang);
    });

    it('reconciles: settled is net less the provider’s fees', async () => {
      const view = await serviceWith(portReturning().port).load(ORG, {});
      const t = view.totals;
      expect(t.netSatang - t.feesSatang).toBe(t.settledSatang);
    });

    it('totals the whole filter, not the page on screen', async () => {
      const { port } = portReturning({
        rows: [
          {
            eventId: 'e1',
            eventName: 'One of many',
            startAt: NOW,
            ...money,
            netSatang: 1,
          },
        ],
        matchedEvents: 30,
      });
      const view = await serviceWith(port).load(ORG, {});
      expect(view.totals.netSatang).toBe(90_000);
    });

    it('reports a free event as zeros rather than hiding it', async () => {
      // US-RPT-05: every money column shows ฿0, not a blank or an error.
      const zero = {
        grossSatang: 0,
        vatSatang: 0,
        refundsSatang: 0,
        feesSatang: 0,
        netSatang: 0,
        settledSatang: 0,
      };
      const { port } = portReturning({
        rows: [
          {
            eventId: 'free',
            eventName: 'Community meetup',
            startAt: NOW,
            ...zero,
          },
        ],
        totals: { ...zero },
      });
      const view = await serviceWith(port).load(ORG, {});
      expect(view.rows[0].netSatang).toBe(0);
      expect(view.totals.grossSatang).toBe(0);
    });

    it('answers a filter matching nothing with zeroed tiles, not an error', async () => {
      const zero = {
        grossSatang: 0,
        vatSatang: 0,
        refundsSatang: 0,
        feesSatang: 0,
        netSatang: 0,
        settledSatang: 0,
      };
      const { port } = portReturning({
        rows: [],
        matchedEvents: 0,
        totals: zero,
      });
      const view = await serviceWith(port).load(ORG, { eventId: 'nope' });
      expect(view.rows).toEqual([]);
      expect(view.totals.netSatang).toBe(0);
    });
  });

  describe('against the previous period (US-RPT-02)', () => {
    it('compares gross with the window immediately before this one', async () => {
      const { port, windows } = portReturning({}, { grossSatang: 50_000 });
      await serviceWith(port).load(ORG, {
        from: '2026-07-08',
        to: '2026-07-14',
      });

      expect(windows[0].from).toEqual(bkkMidnight('2026-07-01'));
      expect(windows[0].to).toEqual(bkkMidnight('2026-07-08'));
    });

    it('reads more gross as an improvement', async () => {
      const { port } = portReturning({}, { grossSatang: 53_500 });
      expect(
        (await serviceWith(port).load(ORG, {})).changes.grossSatang,
      ).toMatchObject({ direction: 'up', improved: true });
    });

    it('reads FEWER refunds as an improvement', async () => {
      const { port } = portReturning({}, { refundsSatang: 20_000 });
      expect(
        (await serviceWith(port).load(ORG, {})).changes.refundsSatang,
      ).toMatchObject({ direction: 'down', improved: true });
    });

    it('reads higher fees as a warning', async () => {
      const { port } = portReturning({}, { feesSatang: 1_000 });
      expect(
        (await serviceWith(port).load(ORG, {})).changes.feesSatang.improved,
      ).toBe(false);
    });

    it('passes no verdict on VAT, whichever way it moved', async () => {
      // It is the Revenue Department's money in both periods. Colouring it
      // green would be claiming something about it that is not true.
      const { port } = portReturning({}, { vatSatang: 1_000 });
      const change = (await serviceWith(port).load(ORG, {})).changes.vatSatang;
      expect(change.direction).toBe('up');
      expect(change.improved).toBeNull();
    });
  });
});
