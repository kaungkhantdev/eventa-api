import { DiscountsReportService } from './discounts-report.service';
import type {
  DiscountPerformancePage,
  DiscountPerformanceRow,
  DiscountReportPort,
} from './ports/discount-report.port';

/**
 * Promotion and discount payback (US-RPT-10).
 *
 * The sums are SQL's and the e2e proves them. What is tested here is the part
 * that carries meaning: how a code's terms read, and the return it gave — which
 * has to refuse to exist for a code nobody has used, rather than claiming zero.
 */

const ORG = 13;
const NOW = new Date('2026-07-19T11:40:00.000Z');

const row = (
  over: Partial<DiscountPerformanceRow> = {},
): DiscountPerformanceRow => ({
  discountId: 'd-1',
  code: 'EARLYBIRD',
  kind: 'percent',
  value: 25,
  standing: 'active',
  eventName: 'Tech Summit 2026',
  redemptions: 40,
  discountSatang: 200_000,
  influencedSatang: 800_000,
  ...over,
});

const TOTALS = {
  activeCodes: 1,
  redemptions: 40,
  discountSatang: 200_000,
  influencedSatang: 800_000,
};

function serviceWith(page: Partial<DiscountPerformancePage> = {}) {
  const port: DiscountReportPort = {
    payback: () =>
      Promise.resolve({
        rows: [row()],
        matchedCodes: 1,
        totals: TOTALS,
        ...page,
      }),
  };
  return new DiscountsReportService(port, { now: () => NOW });
}

describe('DiscountsReportService (US-RPT-10)', () => {
  describe('how a code’s terms read', () => {
    it('describes a percentage code by its percentage', async () => {
      const view = await serviceWith().load(ORG, {});
      expect(view.rows[0].terms).toBe('25% off');
    });

    it('describes a fixed code in satang, for the edge to format', async () => {
      // Never a formatted string here: money crosses to Baht once, at the edge.
      const service = serviceWith({
        rows: [row({ kind: 'fixed', value: 20_000 })],
      });
      const [only] = (await service.load(ORG, {})).rows;
      expect(only.terms).toBeNull();
      expect(only.fixedValueSatang).toBe(20_000);
    });

    it('says which event a code is scoped to', async () => {
      expect((await serviceWith().load(ORG, {})).rows[0].scope).toBe(
        'Tech Summit 2026',
      );
    });

    it('says "All events" for a code scoped to none', async () => {
      const service = serviceWith({ rows: [row({ eventName: null })] });
      expect((await service.load(ORG, {})).rows[0].scope).toBe('All events');
    });
  });

  describe('the return a code gave', () => {
    it('reports the sales per Baht let off', async () => {
      // ฿8,000 of orders for ฿2,000 of discount: four Baht back for one.
      expect((await serviceWith().load(ORG, {})).rows[0].returnRatio).toBe(4);
    });

    it('refuses a ratio for a code nobody has used', async () => {
      // Not zero, and not infinity: an unused code has no return to report.
      const service = serviceWith({
        rows: [
          row({
            standing: 'scheduled',
            redemptions: 0,
            discountSatang: 0,
            influencedSatang: 0,
          }),
        ],
      });
      expect((await service.load(ORG, {})).rows[0].returnRatio).toBeNull();
    });

    it('refuses a ratio where nothing was given away', async () => {
      // A 100%-off code that cost nothing would divide by zero.
      const service = serviceWith({
        rows: [row({ discountSatang: 0, influencedSatang: 50_000 })],
      });
      expect((await service.load(ORG, {})).rows[0].returnRatio).toBeNull();
    });

    it('keeps a scheduled code’s figures at zero rather than hiding it', async () => {
      // The story: redemptions, discount and revenue all read zero, and it is
      // not counted among the active codes.
      const service = serviceWith({
        rows: [
          row({ standing: 'scheduled', redemptions: 0, discountSatang: 0 }),
        ],
        totals: { ...TOTALS, activeCodes: 0 },
      });
      const view = await service.load(ORG, {});
      expect(view.rows[0].redemptions).toBe(0);
      expect(view.totals.activeCodes).toBe(0);
    });
  });

  describe('the tiles', () => {
    it('reports them over the whole filter', async () => {
      const view = await serviceWith().load(ORG, {});
      expect(view.totals).toMatchObject({
        activeCodes: 1,
        redemptions: 40,
        discountSatang: 200_000,
        influencedSatang: 800_000,
      });
    });

    it('rates the workspace’s whole return the same way a row is rated', async () => {
      expect((await serviceWith().load(ORG, {})).totals.returnRatio).toBe(4);
    });

    it('answers a filter matching nothing with zeros, not an error', async () => {
      const service = serviceWith({
        rows: [],
        matchedCodes: 0,
        totals: {
          activeCodes: 0,
          redemptions: 0,
          discountSatang: 0,
          influencedSatang: 0,
        },
      });
      const view = await service.load(ORG, { q: 'nope' });
      expect(view.rows).toEqual([]);
      expect(view.totals.returnRatio).toBeNull();
    });
  });
});
