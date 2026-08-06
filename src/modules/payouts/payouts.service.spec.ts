import type { AuthContext } from '../auth/auth.types';
import type { Clock } from '../../common/time/clock';
import type { PaymentProviderPort } from '../payments/ports/payment-provider.port';
import type { PayoutAccountPort } from './ports/payout-account.port';
import type { SettledFundsPort } from './ports/settled-funds.port';
import type { PayoutsRepository } from './payouts.repository';
import { PayoutsService } from './payouts.service';
import type { PayoutRow } from './payouts.types';

const ORG = 7;
const BAHT = 100;
const LIFETIME = 500_000 * BAHT;
const ALLOCATED = 200_000 * BAHT;
const IN_FLIGHT = 80_000 * BAHT;
const NOW = new Date('2026-06-15T02:00:00Z');

const auth: AuthContext = {
  userId: 'admin-1',
  organizationId: ORG,
  sessionId: 's-1',
  persona: 'admin',
};

const payout = (o: Partial<PayoutRow> = {}): PayoutRow => ({
  id: 1,
  organizationId: ORG,
  reference: 'PO-2026-0001',
  amountSatang: IN_FLIGHT,
  currency: 'THB',
  bankAccount: '•••• 7890',
  status: 'processing',
  periodCovered: 'Jun 2026',
  requestedAt: new Date('2026-06-10T00:00:00Z'),
  completedAt: null,
  failureReason: null,
  ...o,
});

describe('PayoutsService', () => {
  let repo: jest.Mocked<PayoutsRepository>;
  let funds: jest.Mocked<SettledFundsPort>;
  let account: jest.Mocked<PayoutAccountPort>;
  let provider: jest.Mocked<PaymentProviderPort>;
  let service: PayoutsService;

  beforeEach(() => {
    repo = {
      page: jest.fn().mockResolvedValue({ items: [payout()], total: 1 }),
      findByReference: jest.fn().mockResolvedValue(payout()),
      allocatedSatang: jest.fn().mockResolvedValue(ALLOCATED),
      totalsByStatus: jest
        .fn()
        .mockResolvedValue({ pending: IN_FLIGHT, paid: ALLOCATED }),
      markRetried: jest
        .fn()
        .mockResolvedValue(payout({ status: 'processing' })),
    } as unknown as jest.Mocked<PayoutsRepository>;
    funds = {
      lifetimeNetSatang: jest.fn().mockResolvedValue(LIFETIME),
    };
    account = {
      findAccount: jest
        .fn()
        .mockResolvedValue({ connected: true, accountId: 'acct_123' }),
    };
    provider = {
      payoutSettingsLink: jest
        .fn()
        .mockResolvedValue('https://provider.test/express'),
      retryPayout: jest.fn().mockResolvedValue({
        payoutRef: 'po_new',
        status: 'processing',
        failureReason: null,
      }),
    } as unknown as jest.Mocked<PaymentProviderPort>;
    const clock: Clock = { now: () => NOW };
    service = new PayoutsService(repo, funds, account, provider, clock);
  });

  describe('balances (US-FIN-03)', () => {
    it('shows available, pending and paid-out to date', async () => {
      const balances = await service.balances(auth);
      // Available is what has settled but is not yet spoken for by a payout.
      expect(balances.availableSatang).toBe(LIFETIME - ALLOCATED);
      expect(balances.pendingSatang).toBe(IN_FLIGHT);
      expect(balances.paidOutSatang).toBe(ALLOCATED);
      expect(balances.payoutsConnected).toBe(true);
    });

    it('matches pending to the payout actually in flight', async () => {
      const balances = await service.balances(auth);
      expect(balances.pendingSatang).toBe(payout().amountSatang);
    });

    it('never reports a negative available balance', async () => {
      // Refunds can outrun what is left unallocated; ฿0 is the floor a person
      // understands, and the shortfall shows up in the next payout instead.
      funds.lifetimeNetSatang.mockResolvedValue(ALLOCATED - 1);
      expect((await service.balances(auth)).availableSatang).toBe(0);
    });

    it('reads as unavailable when no payout account is connected', async () => {
      account.findAccount.mockResolvedValue({
        connected: false,
        accountId: null,
      });
      const balances = await service.balances(auth);
      expect(balances.payoutsConnected).toBe(false);
      // Null, not zero: "not set up" is not the same as "you earned nothing".
      expect(balances.availableSatang).toBeNull();
      expect(balances.pendingSatang).toBeNull();
      expect(balances.paidOutSatang).toBeNull();
    });
  });

  describe('history (US-FIN-03)', () => {
    it('passes the status filter through', async () => {
      await service.list(auth, { status: 'failed' });
      expect(repo.page).toHaveBeenCalledWith(
        ORG,
        expect.objectContaining({ status: 'failed' }),
      );
    });

    it('masks the destination account on every row', async () => {
      repo.page.mockResolvedValue({
        items: [payout({ bankAccount: '1234567890' })],
        total: 1,
      });
      const { items } = await service.list(auth, {});
      expect(items[0].bankAccount).toBe('•••• 7890');
      expect(items[0].bankAccount).not.toContain('123456');
    });
  });

  describe('one payout and its timeline (US-FIN-04)', () => {
    it('returns the amount, masked destination, dates and progress', async () => {
      const detail = await service.detail(auth, 'PO-2026-0001');
      expect(detail.amountSatang).toBe(IN_FLIGHT);
      expect(detail.bankAccount).toBe('•••• 7890');
      expect(detail.timeline.map((t) => t.step)).toEqual([
        'requested',
        'processing',
        'paid',
      ]);
    });

    it('offers a receipt only once the money has landed', async () => {
      expect(
        (await service.detail(auth, 'PO-2026-0001')).canDownloadReceipt,
      ).toBe(false);
      repo.findByReference.mockResolvedValue(
        payout({ status: 'paid', completedAt: NOW }),
      );
      expect(
        (await service.detail(auth, 'PO-2026-0001')).canDownloadReceipt,
      ).toBe(true);
    });

    it('refuses a payout belonging to another workspace', async () => {
      repo.findByReference.mockResolvedValue(null);
      await expect(service.detail(auth, 'PO-X')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  describe('retrying a failed payout (US-FIN-04)', () => {
    beforeEach(() => {
      repo.findByReference.mockResolvedValue(
        payout({ status: 'failed', failureReason: 'account_closed' }),
      );
    });

    it('re-submits the SAME payout rather than creating a second', async () => {
      const result = await service.retry(auth, 'PO-2026-0001');
      expect(provider.retryPayout).toHaveBeenCalledWith(
        expect.objectContaining({
          reference: 'PO-2026-0001',
          amountSatang: IN_FLIGHT,
          accountId: 'acct_123',
        }),
      );
      expect(repo.markRetried).toHaveBeenCalledWith(
        ORG,
        'PO-2026-0001',
        expect.objectContaining({ status: 'processing', gatewayRef: 'po_new' }),
      );
      expect(result.status).toBe('processing');
    });

    it('refuses to retry a payout that has not failed', async () => {
      repo.findByReference.mockResolvedValue(payout({ status: 'processing' }));
      await expect(service.retry(auth, 'PO-2026-0001')).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(provider.retryPayout).not.toHaveBeenCalled();
    });

    it('records a second failure with its reason instead of pretending it worked', async () => {
      provider.retryPayout.mockResolvedValue({
        payoutRef: '',
        status: 'failed',
        failureReason: 'insufficient_funds',
      });
      await expect(service.retry(auth, 'PO-2026-0001')).rejects.toMatchObject({
        code: 'INTERNAL_ERROR',
      });
      expect(repo.markRetried).toHaveBeenCalledWith(
        ORG,
        'PO-2026-0001',
        expect.objectContaining({
          status: 'failed',
          failureReason: 'insufficient_funds',
        }),
      );
    });

    it('refuses when no payout account is connected', async () => {
      account.findAccount.mockResolvedValue({
        connected: false,
        accountId: null,
      });
      await expect(service.retry(auth, 'PO-2026-0001')).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });
  });

  describe('managing bank details at the provider (US-FIN-05)', () => {
    it('hands back the provider’s hosted link', async () => {
      const link = await service.settingsLink(auth);
      expect(link.url).toBe('https://provider.test/express');
      expect(link.connected).toBe(true);
      expect(provider.payoutSettingsLink).toHaveBeenCalledWith('acct_123');
    });

    it('asks the organizer to connect first when there is no account', async () => {
      account.findAccount.mockResolvedValue({
        connected: false,
        accountId: null,
      });
      const link = await service.settingsLink(auth);
      expect(link.connected).toBe(false);
      expect(link.url).toBeNull();
    });
  });
});
