import { TransactionsReportService } from './transactions-report.service';
import type {
  LedgerEntry,
  LedgerPage,
  LedgerTotals,
  TransactionLedgerPort,
} from './ports/transaction-ledger.port';

/**
 * The transaction ledger (US-RPT-06).
 *
 * The union and the sums are SQL's; the e2e proves them. What is tested here is
 * the success rate — the one figure the story defines precisely, and the one
 * with a case where the honest answer is no rate at all.
 */

const ORG = 17;
const NOW = new Date('2026-07-19T11:40:00.000Z');

const entry = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: 'payment:p-1',
  kind: 'payment',
  reference: 'TXN-8842',
  at: new Date('2026-07-18T02:00:00.000Z'),
  personName: 'Ploy Srisai',
  eventId: 'e-1',
  eventName: 'Tech Summit 2026',
  method: 'Card',
  amountSatang: 125_000,
  outcome: 'succeeded',
  paymentId: 'p-1',
  ...over,
});

const totals = (over: Partial<LedgerTotals> = {}): LedgerTotals => ({
  entries: 10,
  payments: 8,
  failed: 2,
  refunds: 1,
  collectedSatang: 1_000_000,
  refundedSatang: 125_000,
  ...over,
});

function serviceWith(page: Partial<LedgerPage> = {}) {
  const port: TransactionLedgerPort = {
    ledger: () =>
      Promise.resolve({
        rows: [entry()],
        matchedEntries: 1,
        totals: totals(),
        ...page,
      }),
  };
  return new TransactionsReportService(port, { now: () => NOW });
}

describe('TransactionsReportService (US-RPT-06)', () => {
  describe('the tiles', () => {
    it('counts every entry, both legs of the ledger', async () => {
      expect((await serviceWith().load(ORG, {})).totals.entries).toBe(10);
    });

    it('rates success over attempts, not over entries', async () => {
      // 8 succeeded of 10 attempted (8 paid + 2 failed). The refund is not an
      // attempt at anything and must not be in the denominator.
      expect((await serviceWith().load(ORG, {})).totals.successRate).toBe(80);
    });

    it('counts a failed charge in the rate but not in the money', async () => {
      // The story's own wording, and the reason the two are separate fields.
      const view = await serviceWith().load(ORG, {});
      expect(view.totals.collectedSatang).toBe(1_000_000);
      expect(view.totals.failed).toBe(2);
    });

    it('reports no success rate where nothing was attempted', async () => {
      // A window holding only refunds has no charges to rate — null, not 0%,
      // which would read as "everything failed".
      const service = serviceWith({
        totals: totals({ payments: 0, failed: 0, entries: 1, refunds: 1 }),
      });
      expect((await service.load(ORG, {})).totals.successRate).toBeNull();
    });

    it('reports 0% when every attempt failed', async () => {
      // This one really is zero, and it is the case worth surfacing.
      const service = serviceWith({
        totals: totals({ payments: 0, failed: 4 }),
      });
      expect((await service.load(ORG, {})).totals.successRate).toBe(0);
    });
  });

  describe('a row', () => {
    it('leaves the amount positive and says which way it went', async () => {
      // The minus sign and the colour are the screen's job; a ledger that
      // stored negatives would make every sum a trap.
      const service = serviceWith({
        rows: [entry({ kind: 'refund', amountSatang: 125_000 })],
      });
      const [row] = (await service.load(ORG, {})).rows;
      expect(row.amountSatang).toBe(125_000);
      expect(row.kind).toBe('refund');
    });

    it('carries the payment to link to, for a refund as well', async () => {
      const service = serviceWith({
        rows: [entry({ id: 'refund:r-1', kind: 'refund', paymentId: 'p-1' })],
      });
      expect((await service.load(ORG, {})).rows[0].paymentId).toBe('p-1');
    });

    it('answers a filter matching nothing without erroring', async () => {
      const service = serviceWith({
        rows: [],
        matchedEntries: 0,
        totals: totals({
          entries: 0,
          payments: 0,
          failed: 0,
          refunds: 0,
          collectedSatang: 0,
          refundedSatang: 0,
        }),
      });
      const view = await service.load(ORG, { q: 'nope' });
      expect(view.rows).toEqual([]);
      expect(view.totals.successRate).toBeNull();
    });
  });
});
