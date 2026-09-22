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

/** What a provider's refund callback reported, for the workspace its URL named. */
export interface ProviderRefundReport {
  organizationId: number;
  /** The provider's reference for the REFUND — `refunds.gateway_ref`. */
  refundRef: string;
  outcome: 'succeeded' | 'failed';
  /** What the provider says it returned, in satang. */
  amountSatang: number;
  failureReason: string | null;
}

/** What finishing a pending refund came to — the webhook log records it. */
export type RefundCompletion =
  | 'settled'
  | 'failed'
  | 'unknown'
  | 'already_final'
  | 'amount_mismatch'
  | 'failed_after_settled';

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
 * actually settles. It keeps the provider's reference instead, and the
 * provider's refund webhook finishes it through `completePending` — in the
 * very transaction step 3 uses, so a refund settled later lands exactly as one
 * settled at once.
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
      await this.repo.markRefundPending(
        refund.id,
        outcome.refundRef,
        this.clock.now(),
      );
      this.logger.log(
        { refundId: refund.id, refundRef: outcome.refundRef },
        'refund accepted but not settled — the ticket stays valid until it is',
      );
      return { ...this.toResult(refund), status: 'pending' };
    }
    await this.completeRefund(refund, outcome.refundRef);
    return { ...this.toResult(refund), status: 'succeeded' };
  }

  /**
   * Finish a refund the provider did not settle when it was issued (US-FIN-02),
   * from the provider's own refund callback.
   *
   * Only a `pending` row moves, which is what makes a redelivered event — or a
   * second event about the same refund — change nothing. The lookup is scoped
   * to the workspace the callback's URL named.
   */
  async completePending(
    report: ProviderRefundReport,
  ): Promise<RefundCompletion> {
    const refund = await this.repo.findRefundByGatewayRef(
      report.organizationId,
      report.refundRef,
    );
    if (!refund) return 'unknown';
    if (refund.status !== 'pending') return this.onFinished(refund, report);
    if (report.outcome === 'failed') return this.onFailed(refund, report);
    return this.onConfirmed(refund, report);
  }

  /**
   * A report about a refund already finished. The one that matters is a
   * failure after it SETTLED — Stripe can take a refund back when the buyer's
   * bank returns it. The tickets are already void and the place may have been
   * sold again, so reviving them would be a guess; a person has to look.
   */
  private onFinished(
    refund: RefundRow,
    report: ProviderRefundReport,
  ): RefundCompletion {
    if (refund.status === 'succeeded' && report.outcome === 'failed') {
      this.logger.warn(
        { refundId: refund.id, reason: report.failureReason },
        'the provider failed a refund already settled here — tickets stay void, follow up by hand',
      );
      return 'failed_after_settled';
    }
    return 'already_final';
  }

  /** The money never went back, so the buyer keeps a valid ticket. */
  private async onFailed(
    refund: RefundRow,
    report: ProviderRefundReport,
  ): Promise<RefundCompletion> {
    await this.repo.markRefundFailed(refund.id, report.failureReason);
    return 'failed';
  }

  /**
   * The same rule as settling a payment: a different amount settles nothing,
   * because voiding tickets on the strength of a partial refund would take the
   * admission away for money the buyer never got back.
   */
  private async onConfirmed(
    refund: RefundRow,
    report: ProviderRefundReport,
  ): Promise<RefundCompletion> {
    if (report.amountSatang !== refund.amountSatang) {
      this.logger.warn(
        {
          refundId: refund.id,
          expected: refund.amountSatang,
          got: report.amountSatang,
        },
        'refund webhook: amount mismatch — refusing to settle',
      );
      return 'amount_mismatch';
    }
    await this.completeRefund(refund, report.refundRef);
    return 'settled';
  }

  /**
   * Step 3 of the class note, shared by both paths: void the tickets, return
   * their stock and flip payment and refund — in ONE transaction.
   */
  private async completeRefund(
    refund: RefundRow,
    gatewayRef: string,
  ): Promise<void> {
    await this.orders.refundOrder(refund.organizationId, refund.orderId, (tx) =>
      this.repo.markRefundedIn(tx, {
        refundId: refund.id,
        paymentId: refund.paymentId,
        gatewayRef,
        now: this.clock.now(),
      }),
    );
  }

  private toResult(refund: RefundRow): RefundResult {
    return {
      refundId: refund.id,
      status: refund.status,
      amountSatang: refund.amountSatang,
    };
  }
}
