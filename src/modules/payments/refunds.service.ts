import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { Clock } from '../../common/time/clock';
import type { AuthContext } from '../auth/auth.types';
import { OrderPaymentPort } from './ports/order-payment.port';
import { PaymentProviderPort } from './ports/payment-provider.port';
import type { PaymentRow, RefundRow } from './payments.repository';
import { PaymentsRepository } from './payments.repository';

export interface RefundPaymentRequest {
  paymentId: string;
  /** Exactly-once: a double-clicked refund must issue one, not two. */
  idempotencyKey: string;
}

export interface RefundResult {
  refundId: string;
  status: RefundRow['status'];
  amountSatang: number;
}

const NOT_PAID =
  'Only a completed payment can be refunded — this one never cleared.';
const ALREADY_REFUNDED = 'This payment has already been refunded.';
const NO_GATEWAY_REF =
  'This payment has no provider reference, so it cannot be refunded automatically.';

/**
 * Issue a refund (US-FIN-02). Full refunds only this release, admin-only, and
 * exactly once however many times the button is pressed.
 *
 * The order of operations is the whole design:
 *
 * 1. **Claim the ledger row first.** `uq_refunds_org_idem` makes the claim the
 *    thing that decides who refunds — so a second request finds the row instead
 *    of calling the provider again, and a crash after the provider call still
 *    leaves evidence that a refund was attempted.
 * 2. **Then call the provider**, outside any transaction, because a network
 *    call inside one holds locks for as long as Stripe takes to answer.
 * 3. **Then free the inventory in ONE transaction** with the ledger write: the
 *    payment flips to refunded, the tickets are voided and their seats go back,
 *    and the refund row is marked succeeded — together or not at all.
 *
 * A `pending` refund (PromptPay, where Stripe must still collect the buyer's
 * bank details) deliberately frees nothing yet. The money has not landed back,
 * so voiding the ticket now would take the admission away before the refund
 * actually settles.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly repo: PaymentsRepository,
    private readonly provider: PaymentProviderPort,
    private readonly orders: OrderPaymentPort,
    private readonly clock: Clock,
  ) {}

  async refund(
    auth: AuthContext,
    input: RefundPaymentRequest,
  ): Promise<RefundResult> {
    const payment = await this.requireRefundable(auth, input.paymentId);
    const { refund, fresh } = await this.repo.claimRefund({
      organizationId: auth.organizationId,
      paymentId: payment.id,
      orderId: payment.orderId,
      amountSatang: payment.amountSatang,
      currency: payment.currency,
      issuedBy: auth.userId,
      idempotencyKey: input.idempotencyKey,
      now: this.clock.now(),
    });
    if (!fresh) return this.toResult(refund);
    return this.settleRefund(payment, refund);
  }

  private async requireRefundable(
    auth: AuthContext,
    paymentId: string,
  ): Promise<PaymentRow & { gatewayRef: string }> {
    const payment = await this.repo.findPaymentForRefund(
      auth.organizationId,
      paymentId,
    );
    if (!payment) throw DomainException.notFound('Payment not found.');
    if (payment.status === 'refunded') {
      throw DomainException.conflict(ALREADY_REFUNDED);
    }
    if (payment.status !== 'paid') throw DomainException.conflict(NOT_PAID);
    if (!payment.gatewayRef) throw DomainException.conflict(NO_GATEWAY_REF);
    return { ...payment, gatewayRef: payment.gatewayRef };
  }

  private async settleRefund(
    payment: PaymentRow & { gatewayRef: string },
    refund: RefundRow,
  ): Promise<RefundResult> {
    const outcome = await this.provider.refund({
      organizationId: payment.organizationId,
      gatewayRef: payment.gatewayRef,
      // The payment's own amount, never a number from the request.
      amountSatang: payment.amountSatang,
      idempotencyKey: refund.idempotencyKey,
    });
    if (outcome.status === 'failed') {
      await this.repo.markRefundFailed(refund.id, outcome.failureReason);
      throw new DomainException(
        ErrorCode.INTERNAL_ERROR,
        `The provider refused the refund: ${outcome.failureReason ?? 'no reason given'}.`,
        HttpStatus.BAD_GATEWAY,
      );
    }
    if (outcome.status === 'pending') {
      this.logger.log(
        { refundId: refund.id, refundRef: outcome.refundRef },
        'refund accepted but not settled — the ticket stays valid until it is',
      );
      return { ...this.toResult(refund), status: 'pending' };
    }
    await this.orders.refundOrder(
      payment.organizationId,
      payment.orderId,
      (tx) =>
        this.repo.markRefundedIn(tx, {
          refundId: refund.id,
          paymentId: payment.id,
          gatewayRef: outcome.refundRef,
          now: this.clock.now(),
        }),
    );
    return { ...this.toResult(refund), status: 'succeeded' };
  }

  private toResult(refund: RefundRow): RefundResult {
    return {
      refundId: refund.id,
      status: refund.status,
      amountSatang: refund.amountSatang,
    };
  }
}
