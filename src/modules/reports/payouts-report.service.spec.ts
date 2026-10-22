import { PayoutsReportService } from './payouts-report.service';
import type {
  PayoutReportPage,
  PayoutReportPort,
  PayoutReportQuery,
  PayoutReportRow,
  PayoutReportTotals,
} from './ports/payout-report.port';
import { resolveReportPeriod } from './reports-period';
import { DEFAULT_REPORT_LIMIT } from '../../common/constants/reports.constants';

/**
 * The payouts report (US-RPT-07).
 *
 * Which payouts match, what they cover and what they add up to are SQL's; the
 * e2e proves them. What is tested here is what the service adds — the average
 * payout, the one figure with a case where the honest answer is none — and that
 * the filter reaches Payouts intact.
 */

const ORG = 17;
const NOW = new Date('2026-07-19T11:40:00.000Z');

const row = (over: Partial<PayoutReportRow> = {}): PayoutReportRow => ({
  reference: 'PO-2043',
  at: new Date('2026-07-15T03:00:00.000Z'),
  bankAccount: '•••• 6042',
  events: [{ eventId: 'e-1', eventName: 'Tech Summit 2026' }],
  amountSatang: 34_200_000,
  status: 'paid',
  ...over,
});

const totals = (
  over: Partial<PayoutReportTotals> = {},
): PayoutReportTotals => ({
  payouts: 4,
  paidOutSatang: 30_000_000,
  inTransitSatang: 8_000_000,
  pendingSatang: 2_000_001,
  ...over,
});

function serviceWith(page: Partial<PayoutReportPage> = {}) {
  const asked: PayoutReportQuery[] = [];
  const port: PayoutReportPort = {
    payouts: (_organizationId, query) => {
      asked.push(query);
      return Promise.resolve({
        rows: [row()],
        matchedPayouts: 1,
        totals: totals(),
        ...page,
      });
    },
  };
  return { service: new PayoutsReportService(port, { now: () => NOW }), asked };
}

describe('PayoutsReportService (US-RPT-07)', () => {
  describe('the tiles', () => {
    it('averages every payout the report shows, to the whole satang', async () => {
      // (30,000,000 + 8,000,000 + 2,000,001) / 4 = 10,000,000.25
      const { service } = serviceWith();
      expect((await service.load(ORG, {})).totals.averageSatang).toBe(
        10_000_000,
      );
    });

    it('carries paid out, in transit and pending through as Payouts summed them', async () => {
      const { service } = serviceWith();
      expect((await service.load(ORG, {})).totals).toMatchObject({
        payouts: 4,
        paidOutSatang: 30_000_000,
        inTransitSatang: 8_000_000,
        pendingSatang: 2_000_001,
      });
    });

    // US-RPT-02: "zeroed figures, not an error". The average is the exception:
    // with no payouts there is no average, and ฿0 would read as a payout of
    // nothing.
    it('has zeroed totals and no average at all when nothing matched', async () => {
      const { service } = serviceWith({
        rows: [],
        matchedPayouts: 0,
        totals: totals({
          payouts: 0,
          paidOutSatang: 0,
          inTransitSatang: 0,
          pendingSatang: 0,
        }),
      });
      const view = await service.load(ORG, { q: 'no-such-payout' });
      expect(view.rows).toEqual([]);
      expect(view.totals).toEqual({
        payouts: 0,
        paidOutSatang: 0,
        inTransitSatang: 0,
        pendingSatang: 0,
        averageSatang: null,
      });
    });
  });

  describe('the filter', () => {
    it('asks Payouts for the window, event, search and page it was given', async () => {
      const filter = {
        from: '2026-07-01',
        to: '2026-07-31',
        eventId: 'e-2',
        q: 'PO-20',
        page: 3,
        limit: 10,
      };
      const { service, asked } = serviceWith();
      const view = await service.load(ORG, filter);
      const period = resolveReportPeriod(filter, NOW);
      expect(asked).toEqual([
        {
          from: period.from,
          to: period.to,
          eventId: 'e-2',
          search: 'PO-20',
          page: 3,
          limit: 10,
        },
      ]);
      expect(view.period).toEqual(period);
    });

    it('starts at the first page, at the standard size', async () => {
      const { service, asked } = serviceWith();
      await service.load(ORG, {});
      expect(asked[0]).toMatchObject({ page: 1, limit: DEFAULT_REPORT_LIMIT });
    });

    it('passes the rows and the match count through for paging', async () => {
      const { service } = serviceWith({ matchedPayouts: 37 });
      const view = await service.load(ORG, {});
      expect(view.rows).toEqual([row()]);
      expect(view.matchedPayouts).toBe(37);
    });
  });
});
