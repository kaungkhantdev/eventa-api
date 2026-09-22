import { DomainException } from '../../common/errors/domain.exception';
import type { Clock } from '../../common/time/clock';
import type { AuthContext } from '../auth/auth.types';
import type { OrderPaymentPort } from './ports/order-payment.port';
import type { PaymentProviderPort } from './ports/payment-provider.port';
import type { PaymentRow, RefundRow } from './payments.repository';
import type { PaymentsRepository } from './payments.repository';
import { RefundsService, type ProviderRefundReport } from './refunds.service';

const NOW = new Date('2026-06-01T00:00:00Z');
const ORG = 7;
const BAHT = 100;
const TOTAL = 1_880 * BAHT;
const PAYMENT_ID = 'p-1';

const auth: AuthContext = {
  userId: 'admin-1',
  organizationId: ORG,
  sessionId: 's-1',
  persona: 'admin',
};

/** The account the original charge was made on. */
const ACCOUNT = 'acct_workspace7';

const payment = (o: Partial<PaymentRow> = {}) =>
  ({
    id: PAYMENT_ID,
    organizationId: ORG,
    orderId: 'o-1',
    amountSatang: TOTAL,
    currency: 'THB',
    status: 'paid',
    gatewayRef: 'pi_123',
    gatewayAccountId: ACCOUNT,
    ...o,
  }) as PaymentRow;

const refundRow = (o: Partial<RefundRow> = {}) =>
  ({
    id: 'r-1',
    organizationId: ORG,
    paymentId: PAYMENT_ID,
    orderId: 'o-1',
    amountSatang: TOTAL,
    status: 'pending',
    ...o,
  }) as RefundRow;

describe('RefundsService (US-FIN-02)', () => {
  let repo: jest.Mocked<PaymentsRepository>;
  let provider: jest.Mocked<PaymentProviderPort>;
  let orders: jest.Mocked<OrderPaymentPort>;
  let service: RefundsService;

  beforeEach(() => {
    repo = {
      findPaymentForRefund: jest.fn().mockResolvedValue(payment()),
      claimRefund: jest
        .fn()
        .mockResolvedValue({ refund: refundRow(), fresh: true }),
      markRefundFailed: jest.fn().mockResolvedValue(undefined),
      markRefundedIn: jest.fn().mockResolvedValue(undefined),
      markRefundPending: jest.fn().mockResolvedValue(undefined),
      findRefundByGatewayRef: jest
        .fn()
        .mockResolvedValue(refundRow({ gatewayRef: 're_pending' })),
    } as unknown as jest.Mocked<PaymentsRepository>;
    provider = {
      refund: jest.fn().mockResolvedValue({
        refundRef: 're_123',
        status: 'succeeded',
        failureReason: null,
      }),
    } as unknown as jest.Mocked<PaymentProviderPort>;
    orders = {
      refundOrder: jest
        .fn()
        .mockImplementation((_o, _r, work: (tx: unknown) => Promise<void>) =>
          work({}).then(() => ({ ticketsVoided: 2, seatsReleased: 2 })),
        ),
    } as unknown as jest.Mocked<OrderPaymentPort>;
    const clock: Clock = { now: () => NOW };
    service = new RefundsService(repo, provider, orders, clock);
  });

  const refund = (o: Record<string, unknown> = {}) =>
    service.refund(auth, {
      paymentId: PAYMENT_ID,
      idempotencyKey: 'k-1',
      ...o,
    });

  it('refunds the full amount from the PAYMENT, never a number the caller sent', async () => {
    await refund({ amountSatang: 1 });
    expect(provider.refund).toHaveBeenCalledWith(
      expect.objectContaining({ amountSatang: TOTAL, gatewayRef: 'pi_123' }),
    );
  });

  /**
   * The reversal is made with the same workspace's key that took the money —
   * the provider authenticates AS the organizer, so naming the account is
   * neither needed nor possible. What it does need is whose key to use.
   */
  it('reverses as the workspace that took the money', async () => {
    await refund();
    expect(provider.refund).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG }),
    );
  });

  it('frees the ticket and its seat in the same transaction as the ledger', async () => {
    const result = await refund();
    expect(orders.refundOrder).toHaveBeenCalledWith(
      ORG,
      'o-1',
      expect.any(Function),
    );
    expect(repo.markRefundedIn).toHaveBeenCalled();
    expect(result.status).toBe('succeeded');
  });

  it('claims the ledger row BEFORE calling the provider', async () => {
    const order: string[] = [];
    repo.claimRefund.mockImplementation(() => {
      order.push('claim');
      return Promise.resolve({ refund: refundRow(), fresh: true });
    });
    provider.refund.mockImplementation(() => {
      order.push('provider');
      return Promise.resolve({
        refundRef: 're_123',
        status: 'succeeded',
        failureReason: null,
      });
    });
    await refund();
    // Claiming first is what makes a crash mid-flight recoverable: the row is
    // evidence a refund was attempted, so nobody refunds a second time.
    expect(order).toEqual(['claim', 'provider']);
  });

  it('issues exactly one refund when the same key arrives twice', async () => {
    repo.claimRefund.mockResolvedValue({
      refund: refundRow({ status: 'succeeded' }),
      fresh: false,
    });
    const result = await refund();
    expect(provider.refund).not.toHaveBeenCalled();
    expect(orders.refundOrder).not.toHaveBeenCalled();
    expect(result.status).toBe('succeeded');
  });

  it('refuses a payment that never completed', async () => {
    repo.findPaymentForRefund.mockResolvedValue(payment({ status: 'pending' }));
    await expect(refund()).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(provider.refund).not.toHaveBeenCalled();
  });

  it('refuses a payment already refunded', async () => {
    repo.findPaymentForRefund.mockResolvedValue(
      payment({ status: 'refunded' }),
    );
    await expect(refund()).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('refuses a payment with no provider reference to refund against', async () => {
    // Nothing to ask the provider to reverse; refunding blind is worse than a 409.
    repo.findPaymentForRefund.mockResolvedValue(payment({ gatewayRef: null }));
    await expect(refund()).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(provider.refund).not.toHaveBeenCalled();
  });

  it('refuses a payment belonging to another workspace', async () => {
    repo.findPaymentForRefund.mockResolvedValue(null);
    await expect(refund()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('records a provider failure and leaves the ticket alone', async () => {
    provider.refund.mockResolvedValue({
      refundRef: 're_bad',
      status: 'failed',
      failureReason: 'expired_or_canceled_card',
    });
    const err = await refund().catch((e: unknown) => e);
    expect((err as DomainException).getStatus()).toBe(502);
    expect(repo.markRefundFailed).toHaveBeenCalledWith(
      'r-1',
      'expired_or_canceled_card',
    );
    // The buyer still holds a valid ticket, because the money did not move.
    expect(orders.refundOrder).not.toHaveBeenCalled();
  });

  it('leaves a PromptPay refund pending without freeing the ticket yet', async () => {
    // The money has not landed back; Stripe is still collecting bank details.
    provider.refund.mockResolvedValue({
      refundRef: 're_pending',
      status: 'pending',
      failureReason: null,
    });
    const result = await refund();
    expect(result.status).toBe('pending');
    expect(orders.refundOrder).not.toHaveBeenCalled();
  });

  it('records the provider’s reference on a pending refund, so its webhook can find it', async () => {
    provider.refund.mockResolvedValue({
      refundRef: 're_pending',
      status: 'pending',
      failureReason: null,
    });
    await refund();
    expect(repo.markRefundPending).toHaveBeenCalledWith(
      'r-1',
      're_pending',
      NOW,
    );
  });

  /**
   * The provider's refund webhook finishing a refund left pending — the
   * PromptPay case, settled only once the buyer has given Stripe a bank
   * account. It must land exactly as the immediate path would have.
   */
  describe('completePending — the provider settles later', () => {
    const report = (o: Partial<ProviderRefundReport> = {}) =>
      service.completePending({
        organizationId: ORG,
        refundRef: 're_pending',
        outcome: 'succeeded',
        amountSatang: TOTAL,
        failureReason: null,
        ...o,
      });

    it('looks the refund up only within the workspace the callback named', async () => {
      await report();
      expect(repo.findRefundByGatewayRef).toHaveBeenCalledWith(
        ORG,
        're_pending',
      );
    });

    it('frees the tickets in the same transaction as the ledger, as the immediate path does', async () => {
      const tx = {};
      orders.refundOrder.mockImplementation((_o, _r, work) =>
        work(tx as never).then(() => ({ ticketsVoided: 2, seatsReleased: 0 })),
      );
      expect(await report()).toBe('settled');
      expect(orders.refundOrder).toHaveBeenCalledWith(
        ORG,
        'o-1',
        expect.any(Function),
      );
      expect(repo.markRefundedIn).toHaveBeenCalledWith(tx, {
        refundId: 'r-1',
        paymentId: PAYMENT_ID,
        gatewayRef: 're_pending',
        now: NOW,
      });
    });

    it('does nothing for a refund it has no record of', async () => {
      repo.findRefundByGatewayRef.mockResolvedValue(null);
      expect(await report()).toBe('unknown');
      expect(orders.refundOrder).not.toHaveBeenCalled();
      expect(repo.markRefundFailed).not.toHaveBeenCalled();
    });

    it('does nothing twice — a refund already finished stays as it is', async () => {
      repo.findRefundByGatewayRef.mockResolvedValue(
        refundRow({ status: 'succeeded' }),
      );
      expect(await report()).toBe('already_final');
      expect(orders.refundOrder).not.toHaveBeenCalled();
    });

    it('does not reopen a refund already recorded as failed', async () => {
      repo.findRefundByGatewayRef.mockResolvedValue(
        refundRow({ status: 'failed' }),
      );
      expect(await report()).toBe('already_final');
      expect(orders.refundOrder).not.toHaveBeenCalled();
    });

    it('records a failure and leaves the tickets valid — the money never went back', async () => {
      expect(
        await report({
          outcome: 'failed',
          failureReason: 'insufficient_funds',
        }),
      ).toBe('failed');
      expect(repo.markRefundFailed).toHaveBeenCalledWith(
        'r-1',
        'insufficient_funds',
      );
      expect(orders.refundOrder).not.toHaveBeenCalled();
    });

    it('refuses to settle a refund for a different amount than was issued', async () => {
      expect(await report({ amountSatang: TOTAL - 1 })).toBe('amount_mismatch');
      expect(orders.refundOrder).not.toHaveBeenCalled();
      expect(repo.markRefundFailed).not.toHaveBeenCalled();
    });

    /**
     * Stripe can take a succeeded refund back (the buyer's bank returned it)
     * and then fail it. The tickets are already void; reviving them silently
     * would be a guess, so a person has to look.
     */
    it('flags a failure reported after the refund had already settled, and changes nothing', async () => {
      repo.findRefundByGatewayRef.mockResolvedValue(
        refundRow({ status: 'succeeded' }),
      );
      expect(await report({ outcome: 'failed' })).toBe('failed_after_settled');
      expect(repo.markRefundFailed).not.toHaveBeenCalled();
      expect(orders.refundOrder).not.toHaveBeenCalled();
    });
  });
});
