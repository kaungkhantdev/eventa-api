import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import type { AuthContext } from '../auth/auth.types';
import {
  RegistrationRefundPort,
  type RejectionRefund,
} from '../registrations/ports/registration-refund.port';
import { PaymentsRepository, type PaymentRow } from './payments.repository';
import { RefundsService } from './refunds.service';

const NO_PAYMENT = 'There is no payment on this registration to refund.';
const REFUSED_BEFORE =
  'An earlier attempt to refund it was refused by the provider.';

/**
 * One refund per PAYMENT on a rejected registration, however often the
 * rejection is retried: the ledger's idempotency claim is made on this key,
 * so a second attempt finds the first instead of paying the buyer twice.
 *
 * Per payment, not per order: a registration paid for twice has two payments
 * to give back, and one key for both would let the first refund answer for
 * the second — which would never be made.
 */
function rejectionRefundKey(orderId: string, paymentId: string): string {
  return `registration-rejected:${orderId}:${paymentId}`;
}

/**
 * Payments' implementation of the Registrations-owned refund port (US-REG-02).
 * It adds no way of moving money: it finds the order's payments and hands
 * each to `RefundsService.refund` — the claim, the provider call and the
 * transaction that flips the ledger and gives the inventory back are that
 * service's.
 */
@Injectable()
export class RegistrationRefundAdapter extends RegistrationRefundPort {
  constructor(
    private readonly repo: PaymentsRepository,
    private readonly refunds: RefundsService,
  ) {
    super();
  }

  /**
   * Every payment that settled on the registration goes back — the one that
   * paid for it and any duplicate that landed while it waited. One at a time,
   * oldest first: each refund reads whether another payment still covers the
   * order, and the last one is what marks the order refunded.
   */
  async refundRejected(
    auth: AuthContext,
    orderId: string,
  ): Promise<RejectionRefund> {
    const payments = await this.repo.findSettledPaymentsForOrder(
      auth.organizationId,
      orderId,
    );
    if (payments.length === 0) throw DomainException.conflict(NO_PAYMENT);
    const outcomes: RejectionRefund[] = [];
    for (const payment of payments) {
      outcomes.push(await this.refundPayment(auth, orderId, payment));
    }
    return combined(outcomes);
  }

  private async refundPayment(
    auth: AuthContext,
    orderId: string,
    payment: PaymentRow,
  ): Promise<RejectionRefund> {
    if (payment.status === 'refunded') {
      return { status: 'succeeded', amountSatang: payment.amountSatang };
    }
    const refund = await this.refunds.refund(auth, {
      paymentId: payment.id,
      idempotencyKey: rejectionRefundKey(orderId, payment.id),
    });
    // Only a replay can come back `failed` — a fresh refusal throws inside
    // `refund`. Its key is spent, so reporting success here would be a lie.
    if (refund.status === 'failed') {
      throw DomainException.conflict(REFUSED_BEFORE);
    }
    return { status: refund.status, amountSatang: refund.amountSatang };
  }
}

/** Still pending while any one of them is; the amounts are what went back. */
function combined(outcomes: RejectionRefund[]): RejectionRefund {
  return {
    status: outcomes.some((o) => o.status === 'pending')
      ? 'pending'
      : 'succeeded',
    amountSatang: outcomes.reduce((sum, o) => sum + o.amountSatang, 0),
  };
}
