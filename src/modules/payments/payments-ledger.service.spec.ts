import type { AuthContext } from '../auth/auth.types';
import type { LedgerRow, PaymentsRepository } from './payments.repository';
import { PaymentsLedgerService } from './payments-ledger.service';

const ORG = 7;
const BAHT = 100;

const auth: AuthContext = {
  userId: 'u-1',
  organizationId: ORG,
  sessionId: 's-1',
  persona: 'admin',
};

const row = (o: Partial<LedgerRow> = {}): LedgerRow => ({
  id: 'p-1',
  txn: 'TXN-001',
  payerName: 'Anan Suksawat',
  eventName: 'Bangkok Tech Week',
  method: 'Card',
  amountSatang: 1_880 * BAHT,
  currency: 'THB',
  status: 'paid',
  paidAt: new Date('2026-06-01T00:00:00Z'),
  createdAt: new Date('2026-06-01T00:00:00Z'),
  ...o,
});

describe('PaymentsLedgerService (US-FIN-01)', () => {
  let repo: jest.Mocked<PaymentsRepository>;
  let service: PaymentsLedgerService;

  beforeEach(() => {
    repo = {
      listLedger: jest.fn().mockResolvedValue({ items: [row()], total: 1 }),
      countByStatus: jest
        .fn()
        .mockResolvedValue({ paid: 12, pending: 3, refunded: 2, failed: 5 }),
    } as unknown as jest.Mocked<PaymentsRepository>;
    service = new PaymentsLedgerService(repo);
  });

  const list = (o: Record<string, unknown> = {}) => service.list(auth, o);

  it('lists newest first, scoped to the caller’s workspace', async () => {
    await list();
    expect(repo.listLedger).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ page: 1, limit: 20 }),
    );
  });

  it('passes the status and method filters through', async () => {
    await list({ status: 'refunded', method: 'PromptPay' });
    expect(repo.listLedger).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ status: 'refunded', method: 'PromptPay' }),
    );
  });

  it('searches by payer name or transaction reference', async () => {
    await list({ search: 'TXN-0' });
    expect(repo.listLedger).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ search: 'TXN-0' }),
    );
  });

  it('counts every status across the WHOLE ledger, not just this page', async () => {
    // The tabs show totals; counting the page would make them lie on page 2.
    const result = await list({ status: 'paid', page: 2 });
    expect(repo.countByStatus).toHaveBeenCalledWith(
      ORG,
      expect.not.objectContaining({ status: 'paid' }),
    );
    expect(result.counts).toEqual({
      paid: 12,
      pending: 3,
      refunded: 2,
      failed: 5,
    });
  });

  it('keeps the search in the counts, so the tabs match what is listed', async () => {
    await list({ search: 'Anan', status: 'paid' });
    expect(repo.countByStatus).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ search: 'Anan' }),
    );
  });

  describe('what each row allows', () => {
    it('offers a refund on a paid payment', async () => {
      const [item] = (await list()).page.items;
      expect(item.canRefund).toBe(true);
      expect(item.refundBlockedReason).toBeNull();
    });

    it('explains why a pending payment cannot be refunded', async () => {
      repo.listLedger.mockResolvedValue({
        items: [row({ status: 'pending', paidAt: null })],
        total: 1,
      });
      const [item] = (await list()).page.items;
      expect(item.canRefund).toBe(false);
      expect(item.refundBlockedReason).toMatch(/no completed charge/i);
      expect(item.canViewInvoice).toBe(false);
    });

    it('explains why a failed payment cannot be refunded', async () => {
      repo.listLedger.mockResolvedValue({
        items: [row({ status: 'failed', paidAt: null })],
        total: 1,
      });
      const [item] = (await list()).page.items;
      expect(item.canRefund).toBe(false);
      expect(item.refundBlockedReason).toMatch(/not eligible/i);
    });

    it('does not offer a second refund on an already-refunded payment', async () => {
      repo.listLedger.mockResolvedValue({
        items: [row({ status: 'refunded' })],
        total: 1,
      });
      const [item] = (await list()).page.items;
      expect(item.canRefund).toBe(false);
      expect(item.refundBlockedReason).toMatch(/already refunded/i);
      // The charge did complete, so its invoice remains viewable.
      expect(item.canViewInvoice).toBe(true);
    });
  });
});
