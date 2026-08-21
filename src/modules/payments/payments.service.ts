import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException } from '../../common/errors/domain.exception';
import { formatBaht } from '../../common/money/baht';
import { Clock } from '../../common/time/clock';
import { ticketsUrlFor } from '../checkout/ticket-links';
import type { Env } from '../../config/env.validation';
import type { PayOrderDto } from './dto/pay-order.dto';
import type { PaymentIntentDto } from './dto/payment-intent.dto';
import { GatewayCredentialsPort } from './ports/gateway-credentials.port';
import { MerchantAccountPort } from './ports/merchant-account.port';
import {
  OrderPaymentPort,
  type PayableOrder,
} from './ports/order-payment.port';
import {
  PaymentProviderPort,
  type StartedPayment,
  type VerifiedWebhook,
} from './ports/payment-provider.port';
import { PaymentsRepository, type PaymentRow } from './payments.repository';

/** The webhook's whole reply — the provider only wants to know we have it. */
export interface WebhookAck {
  received: boolean;
}

/**
 * Written for the buyer, who cannot fix this and did nothing wrong: it names
 * the organizer's setup rather than implying the attempt was at fault.
 */
const NO_MERCHANT_ACCOUNT =
  'This event cannot take payment yet — the organizer has not finished connecting their payment account.';

/**
 * Paying for an order (US-DISC-05): start collecting by card or PromptPay, and
 * act on what the provider reports back.
 *
 * Two rules carry everything here. The amount is the ORDER's total, read
 * server-side — the request names an order and a method, never a number. And the
 * webhook is the source of truth for payment state: nothing marks money as
 * arrived except a signature-verified callback, deduplicated by the provider's
 * own event id, and settlement flips the payment row inside the same transaction
 * that issues the tickets — so "paid" and "ticketed" cannot drift apart.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  /** Stamped on every webhook row, so the ledger says who reported it. */
  private static readonly PROVIDER_NAME = 'stripe';
  private readonly publicWebUrl: string;

  constructor(
    private readonly repo: PaymentsRepository,
    private readonly provider: PaymentProviderPort,
    private readonly orders: OrderPaymentPort,
    private readonly merchants: MerchantAccountPort,
    private readonly credentials: GatewayCredentialsPort,
    private readonly clock: Clock,
    config: ConfigService<Env, true>,
  ) {
    this.publicWebUrl = config.getOrThrow('PUBLIC_WEB_URL', { infer: true });
  }

  /** Start collecting. Safe to replay — the idempotency key finds its own attempt. */
  async pay(input: PayOrderDto): Promise<PaymentIntentDto> {
    const order = await this.requirePayable(input.orderId);
    const accountId = await this.requireMerchantAccount(order.organizationId);
    const started = await this.provider.start({
      orderId: order.id,
      organizationId: order.organizationId,
      amountSatang: order.totalSatang,
      currency: order.currency,
      method: input.method,
      buyerEmail: order.buyerEmail,
      statementDescriptor: await this.repo.orgStatementDescriptor(
        order.organizationId,
      ),
      description: order.eventName,
      // Where the provider sends the buyer back: their own copy of the order,
      // which reads correctly whether or not the money has landed yet.
      returnUrl: ticketsUrlFor(this.publicWebUrl, order.id),
      idempotencyKey: input.idempotencyKey,
    });
    const payment = await this.repo.upsertAttempt({
      organizationId: order.organizationId,
      orderId: order.id,
      eventId: order.eventId,
      payerName: order.buyerName,
      method: input.method,
      amountSatang: order.totalSatang,
      currency: order.currency,
      gatewayRef: started.gatewayRef,
      // Stamped now, so the refund reverses on this account however the
      // workspace's settings row changes later.
      gatewayAccountId: accountId,
      statementDescriptor: null,
      idempotencyKey: input.idempotencyKey,
      status: started.status === 'failed' ? 'failed' : 'pending',
      now: this.clock.now(),
    });
    return this.toIntent(
      await this.reconcileGatewayRef(payment, started.gatewayRef),
      order,
      started,
    );
  }

  /**
   * A provider callback. Verified first — an unverified webhook is a stranger
   * claiming an order was paid — then processed exactly once by provider event
   * id, whatever retries or replicas do.
   */
  async handleWebhook(
    token: string,
    rawBody: Buffer,
    signature: string,
  ): Promise<WebhookAck> {
    // The token in the URL is what resolves a tenant: a callback carries no
    // session, and its signature cannot be checked until we know which
    // workspace's signing secret to check it against.
    const identity = await this.credentials.webhookIdentityFor(token);
    if (!identity) {
      // Same answer as a bad signature, and for the same reason: an unknown
      // token must not tell a prober whether it guessed a real workspace.
      throw DomainException.forbidden('Invalid webhook signature.');
    }
    const verified = this.provider.verifyWebhook(
      rawBody,
      signature,
      identity.signingSecrets,
    );
    if (verified.type === 'ignored') return { received: true };
    const fresh = await this.repo.recordWebhook(
      PaymentsService.PROVIDER_NAME,
      verified,
    );
    if (!fresh) return { received: true };

    const payment = await this.repo.findByGatewayRef(verified.gatewayRef);
    if (!payment) {
      // Not ours (another environment, an old test) — acknowledge and move on.
      this.logger.warn(
        { gatewayRef: verified.gatewayRef },
        'webhook: unknown payment',
      );
      await this.repo.markWebhookProcessed(verified.eventId, null, 'processed');
      return { received: true };
    }
    // A hosted checkout settles under the SESSION id, because that is all that
    // existed when the payment was started. Move the row onto the intent the
    // session finally created — it is what a refund takes.
    const settled = verified.settledRef
      ? await this.reconcileGatewayRef(payment, verified.settledRef)
      : payment;
    await this.dispatch(verified, settled);
    return { received: true };
  }

  private async dispatch(
    verified: VerifiedWebhook,
    payment: PaymentRow,
  ): Promise<void> {
    if (verified.type === 'succeeded') {
      return this.onSucceeded(verified, payment);
    }
    // failed: the buyer can retry or switch method, so their seats stay held
    // until the hold TTL runs out on its own. expired: the PromptPay window is
    // gone — release the inventory now so someone else can buy it.
    await this.repo.markFailed(payment.id);
    if (verified.type === 'expired') {
      await this.orders.releaseHolds(payment.organizationId, payment.orderId);
    }
    await this.repo.markWebhookProcessed(
      verified.eventId,
      payment.organizationId,
      'processed',
    );
  }

  private async onSucceeded(
    verified: VerifiedWebhook,
    payment: PaymentRow,
  ): Promise<void> {
    // A wrong amount settles nothing: crediting a ฿2,100 order for a ฿1 payment
    // is exactly the fraud a webhook exists to prevent.
    if (verified.amountSatang !== payment.amountSatang) {
      this.logger.warn(
        {
          paymentId: payment.id,
          expected: payment.amountSatang,
          got: verified.amountSatang,
        },
        'webhook: amount mismatch — refusing to settle',
      );
      await this.repo.markWebhookProcessed(
        verified.eventId,
        payment.organizationId,
        'failed',
      );
      return;
    }
    if (payment.status !== 'paid') {
      const result = await this.orders.settle(
        payment.organizationId,
        payment.orderId,
        (tx) => this.repo.markPaidIn(tx, payment.id, this.clock.now()),
      );
      if (result.outcome === 'refund_required') {
        this.logger.warn(
          { orderId: payment.orderId, reference: result.reference },
          'settlement could not honour the inventory — refund queued',
        );
      }
      if (result.outcome === 'already_settled') {
        await this.refundIfDuplicate(payment);
      }
    }
    await this.repo.markWebhookProcessed(
      verified.eventId,
      payment.organizationId,
      'processed',
    );
  }

  /**
   * An idempotency key is only remembered by the provider for a day or so, so a
   * retry the next morning creates a NEW intent while `upsertAttempt` returns
   * our ORIGINAL row. The buyer is then handed a live instrument the ledger has
   * no reference for, and its webhook would match nothing — money in, no
   * tickets. Repoint the row at the intent the buyer actually got.
   */
  private async reconcileGatewayRef(
    payment: PaymentRow,
    gatewayRef: string,
  ): Promise<PaymentRow> {
    if (payment.gatewayRef === gatewayRef) return payment;
    this.logger.warn(
      { paymentId: payment.id, was: payment.gatewayRef, now: gatewayRef },
      'idempotent retry produced a new intent — repointing the payment',
    );
    await this.repo.updateGatewayRef(payment.id, gatewayRef);
    return { ...payment, gatewayRef };
  }

  /**
   * `already_settled` has two very different causes. Usually it is the same
   * webhook redelivered — nothing to do. But it also fires when a SECOND live
   * payment lands on an order another payment already confirmed, and that money
   * is a genuine double charge: the buyer has one set of tickets and two
   * debits. Only the second case gets a refund event.
   */
  private async refundIfDuplicate(payment: PaymentRow): Promise<void> {
    const duplicate = await this.repo.otherPaidPaymentExists(
      payment.orderId,
      payment.id,
    );
    if (!duplicate) return;
    this.logger.warn(
      { orderId: payment.orderId, paymentId: payment.id },
      'a second payment settled an already-paid order — refund queued',
    );
    await this.orders.queueRefund(payment.organizationId, payment.orderId, {
      amountSatang: payment.amountSatang,
      reason: 'duplicate_payment',
    });
  }

  /**
   * Whose account this charge lands in — and a refusal when there isn't one.
   *
   * Collecting into the platform account instead would take a buyer's money
   * into a balance the organizer cannot reach, issue a valid ticket against it,
   * and leave a payout that can never settle. Stopping the checkout is the
   * smaller failure by a wide margin, and the only one that can be undone.
   *
   * Both halves are checked: a row can be marked connected and still name no
   * account, and charging "on behalf of" nothing is a platform charge wearing
   * a workspace's label.
   */
  private async requireMerchantAccount(
    organizationId: number,
  ): Promise<string> {
    const account = await this.merchants.findAccount(organizationId);
    if (!account.connected || !account.accountId) {
      throw DomainException.conflict(NO_MERCHANT_ACCOUNT);
    }
    return account.accountId;
  }

  private async requirePayable(orderId: string): Promise<PayableOrder> {
    const order = await this.orders.findPayable(orderId);
    if (!order) throw DomainException.notFound("This order isn't available.");
    if (order.paymentStatus === 'paid') {
      throw DomainException.conflict('This order is already paid.');
    }
    // Written for the person reading it: "expired" tells them what to do next
    // (book again), where the generic line leaves them refreshing the page.
    if (order.status === 'expired') {
      throw DomainException.conflict(
        'This order expired — the seats were released. Please book again.',
      );
    }
    if (order.status !== 'pending') {
      throw DomainException.conflict('This order can no longer be paid.');
    }
    if (order.totalSatang === 0) {
      throw DomainException.conflict(
        'This order is free — there is nothing to pay.',
      );
    }
    return order;
  }

  private toIntent(
    payment: PaymentRow,
    order: PayableOrder,
    started: StartedPayment,
  ): PaymentIntentDto {
    return {
      paymentId: payment.id,
      orderId: order.id,
      method: payment.method,
      status: payment.status,
      amountSatang: order.totalSatang,
      amountLabel: formatBaht(order.totalSatang),
      clientSecret: started.clientSecret,
      checkoutUrl: started.checkoutUrl,
      promptPayQr: started.promptPayQr,
      expiresAt: started.expiresAt?.toISOString() ?? null,
      declineReason: started.declineReason,
    };
  }
}
