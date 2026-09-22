import { HttpStatus } from '@nestjs/common';
import { organizerAuth } from '../../../test/support/auth-context';
import { refusalOf } from '../../../test/support/refusal';
import type { PaymentRow, PaymentsRepository } from './payments.repository';
import { RegistrationRefundAdapter } from './registration-refund.adapter';
import type { RefundResult, RefundsService } from './refunds.service';

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

function refunded(o: Partial<RefundResult> = {}): RefundResult {
  return { refundId: 'r-1', status: 'succeeded', amountSatang: AMOUNT, ...o };
}

describe('RegistrationRefundAdapter (US-REG-02 — a rejection refunds)', () => {
  let repo: jest.Mocked<PaymentsRepository>;
  let refunds: jest.Mocked<RefundsService>;
  let adapter: RegistrationRefundAdapter;

  beforeEach(() => {
    repo = {
      findSettledPaymentsForOrder: jest.fn().mockResolvedValue([payment()]),
    } as unknown as jest.Mocked<PaymentsRepository>;
    refunds = {
      refund: jest.fn().mockResolvedValue(refunded()),
    } as unknown as jest.Mocked<RefundsService>;
    adapter = new RegistrationRefundAdapter(repo, refunds);
  });

  it('refunds the payment through the refund path, keyed so each payment is refunded once', async () => {
    await expect(adapter.refundRejected(auth, ORDER)).resolves.toEqual({
      status: 'succeeded',
      amountSatang: AMOUNT,
    });
    expect(repo.findSettledPaymentsForOrder).toHaveBeenCalledWith(7, ORDER);
    expect(refunds.refund).toHaveBeenCalledWith(auth, {
      paymentId: 'p-1',
      idempotencyKey: `registration-rejected:${ORDER}:p-1`,
    });
  });

  it('refunds EVERY payment still held — a registration paid for twice is refunded twice', async () => {
    // The QR scanned after the card paid: both settled while it waited.
    repo.findSettledPaymentsForOrder.mockResolvedValue([
      payment({ id: 'p-1' }),
      payment({ id: 'p-2' }),
    ]);
    await expect(adapter.refundRejected(auth, ORDER)).resolves.toEqual({
      status: 'succeeded',
      amountSatang: 2 * AMOUNT,
    });
    expect(refunds.refund.mock.calls.map(([, input]) => input)).toEqual([
      {
        paymentId: 'p-1',
        idempotencyKey: `registration-rejected:${ORDER}:p-1`,
      },
      {
        paymentId: 'p-2',
        idempotencyKey: `registration-rejected:${ORDER}:p-2`,
      },
    ]);
  });

  it('on a retry, finishes only the payments not yet refunded', async () => {
    repo.findSettledPaymentsForOrder.mockResolvedValue([
      payment({ id: 'p-1', status: 'refunded' }),
      payment({ id: 'p-2' }),
    ]);
    await adapter.refundRejected(auth, ORDER);
    expect(refunds.refund).toHaveBeenCalledTimes(1);
    expect(refunds.refund).toHaveBeenCalledWith(auth, {
      paymentId: 'p-2',
      idempotencyKey: `registration-rejected:${ORDER}:p-2`,
    });
  });

  it('reports a refund the provider has yet to settle as pending', async () => {
    refunds.refund.mockResolvedValue(refunded({ status: 'pending' }));
    await expect(adapter.refundRejected(auth, ORDER)).resolves.toEqual({
      status: 'pending',
      amountSatang: AMOUNT,
    });
  });

  it('is pending while ANY of the refunds is', async () => {
    repo.findSettledPaymentsForOrder.mockResolvedValue([
      payment({ id: 'p-1' }),
      payment({ id: 'p-2' }),
    ]);
    refunds.refund
      .mockResolvedValueOnce(refunded())
      .mockResolvedValueOnce(refunded({ status: 'pending' }));
    await expect(adapter.refundRejected(auth, ORDER)).resolves.toMatchObject({
      status: 'pending',
    });
  });

  it('asks nothing of the provider when every payment was already refunded', async () => {
    repo.findSettledPaymentsForOrder.mockResolvedValue([
      payment({ status: 'refunded' }),
    ]);
    await expect(adapter.refundRejected(auth, ORDER)).resolves.toEqual({
      status: 'succeeded',
      amountSatang: AMOUNT,
    });
    expect(refunds.refund).not.toHaveBeenCalled();
  });

  it('refuses when there is no payment to give back', async () => {
    repo.findSettledPaymentsForOrder.mockResolvedValue([]);
    const refusal = await refusalOf(adapter.refundRejected(auth, ORDER));
    expect(refusal.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(refunds.refund).not.toHaveBeenCalled();
  });

  it('refuses a retry of a refund the provider already turned down, rather than calling it settled', async () => {
    // The key is spent on the failed attempt: a new one has to be issued by
    // Finance, which is what the caller tells the organizer.
    refunds.refund.mockResolvedValue(refunded({ status: 'failed' }));
    const refusal = await refusalOf(adapter.refundRejected(auth, ORDER));
    expect(refusal.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(refusal.message).toMatch(/refused/i);
  });
});
