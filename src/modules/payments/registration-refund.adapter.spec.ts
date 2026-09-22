import { HttpStatus } from '@nestjs/common';
import { organizerAuth } from '../../../test/support/auth-context';
import { refusalOf } from '../../../test/support/refusal';
import type { PaymentRow, PaymentsRepository } from './payments.repository';
import { RegistrationRefundAdapter } from './registration-refund.adapter';
import type { RefundsService } from './refunds.service';

const ORDER = 'o-1';
const AMOUNT = 105_000;
const auth = organizerAuth({ organizationId: 7 });

function payment(o: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: 'p-1',
    organizationId: 7,
    orderId: ORDER,
    status: 'paid',
    amountSatang: AMOUNT,
    ...o,
  } as PaymentRow;
}

describe('RegistrationRefundAdapter (US-REG-02 — a rejection refunds)', () => {
  let repo: jest.Mocked<PaymentsRepository>;
  let refunds: jest.Mocked<RefundsService>;
  let adapter: RegistrationRefundAdapter;

  beforeEach(() => {
    repo = {
      findSettledPaymentForOrder: jest.fn().mockResolvedValue(payment()),
    } as unknown as jest.Mocked<PaymentsRepository>;
    refunds = {
      refund: jest.fn().mockResolvedValue({
        refundId: 'r-1',
        status: 'succeeded',
        amountSatang: AMOUNT,
      }),
    } as unknown as jest.Mocked<RefundsService>;
    adapter = new RegistrationRefundAdapter(repo, refunds);
  });

  it('refunds the payment through the refund path, keyed so the registration is refunded once', async () => {
    await expect(adapter.refundRejected(auth, ORDER)).resolves.toEqual({
      status: 'succeeded',
      amountSatang: AMOUNT,
    });
    expect(repo.findSettledPaymentForOrder).toHaveBeenCalledWith(7, ORDER);
    expect(refunds.refund).toHaveBeenCalledWith(auth, {
      paymentId: 'p-1',
      idempotencyKey: `registration-rejected:${ORDER}`,
    });
  });

  it('reports a refund the provider has yet to settle as pending', async () => {
    refunds.refund.mockResolvedValue({
      refundId: 'r-1',
      status: 'pending',
      amountSatang: AMOUNT,
    });
    await expect(adapter.refundRejected(auth, ORDER)).resolves.toEqual({
      status: 'pending',
      amountSatang: AMOUNT,
    });
  });

  it('asks nothing of the provider when the payment was already refunded', async () => {
    repo.findSettledPaymentForOrder.mockResolvedValue(
      payment({ status: 'refunded' }),
    );
    await expect(adapter.refundRejected(auth, ORDER)).resolves.toEqual({
      status: 'succeeded',
      amountSatang: AMOUNT,
    });
    expect(refunds.refund).not.toHaveBeenCalled();
  });

  it('refuses when there is no payment to give back', async () => {
    repo.findSettledPaymentForOrder.mockResolvedValue(null);
    const refusal = await refusalOf(adapter.refundRejected(auth, ORDER));
    expect(refusal.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(refunds.refund).not.toHaveBeenCalled();
  });

  it('refuses a retry of a refund the provider already turned down, rather than calling it settled', async () => {
    // The key is spent on the failed attempt: a new one has to be issued by
    // Finance, which is what the caller tells the organizer.
    refunds.refund.mockResolvedValue({
      refundId: 'r-1',
      status: 'failed',
      amountSatang: AMOUNT,
    });
    const refusal = await refusalOf(adapter.refundRejected(auth, ORDER));
    expect(refusal.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(refusal.message).toMatch(/refused/i);
  });
});
