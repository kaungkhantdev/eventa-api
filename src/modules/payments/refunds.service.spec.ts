import { DomainException } from '../../common/errors/domain.exception';
import type { Clock } from '../../common/time/clock';
import type { AuthContext } from '../auth/auth.types';
import type { OrderPaymentPort } from './ports/order-payment.port';
import type { PaymentProviderPort } from './ports/payment-provider.port';
import type { PaymentRow, RefundRow } from './payments.repository';
import type { PaymentsRepository } from './payments.repository';
import { RefundsService } from './refunds.service';

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

const payment = (o: Partial<PaymentRow> = {}) =>
  ({
    id: PAYMENT_ID,
    organizationId: ORG,
    orderId: 'o-1',
    amountSatang: TOTAL,
    currency: 'THB',
    status: 'paid',
    gatewayRef: 'pi_123',
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
});
