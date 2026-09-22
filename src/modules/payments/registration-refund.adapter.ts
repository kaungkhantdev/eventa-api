import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import type { AuthContext } from '../auth/auth.types';
import {
  RegistrationRefundPort,
  type RejectionRefund,
} from '../registrations/ports/registration-refund.port';
import { PaymentsRepository } from './payments.repository';
import { RefundsService } from './refunds.service';

const NO_PAYMENT = 'There is no payment on this registration to refund.';
const REFUSED_BEFORE =
  'An earlier attempt to refund it was refused by the provider.';

/**
 * One refund per rejected registration, however often the rejection is
 * retried: the ledger's idempotency claim is made on this key, so a second
 * attempt finds the first instead of paying the buyer twice.
 */
function rejectionRefundKey(orderId: string): string {
  return `registration-rejected:${orderId}`;
}

/**
 * Payments' implementation of the Registrations-owned refund port (US-REG-02).
 * It adds no way of moving money: it finds the order's payment and hands it to
 * `RefundsService.refund` — the claim, the provider call and the transaction
 * that flips the ledger and gives the inventory back are that service's.
 */
@Injectable()
export class RegistrationRefundAdapter extends RegistrationRefundPort {
  constructor(
    private readonly repo: PaymentsRepository,
    private readonly refunds: RefundsService,
  ) {
    super();
  }

  async refundRejected(
    auth: AuthContext,
    orderId: string,
  ): Promise<RejectionRefund> {
    const payment = await this.repo.findSettledPaymentForOrder(
      auth.organizationId,
      orderId,
    );
    if (!payment) throw DomainException.conflict(NO_PAYMENT);
    if (payment.status === 'refunded') {
      return { status: 'succeeded', amountSatang: payment.amountSatang };
    }
    const refund = await this.refunds.refund(auth, {
      paymentId: payment.id,
      idempotencyKey: rejectionRefundKey(orderId),
    });
    // Only a replay can come back `failed` — a fresh refusal throws inside
    // `refund`. Its key is spent, so reporting success here would be a lie.
    if (refund.status === 'failed') {
      throw DomainException.conflict(REFUSED_BEFORE);
    }
    return { status: refund.status, amountSatang: refund.amountSatang };
  }
}
