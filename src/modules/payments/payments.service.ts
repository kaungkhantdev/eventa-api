import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException } from '../../common/errors/domain.exception';
import { formatBaht } from '../../common/money/baht';
import { Clock } from '../../common/time/clock';
import type { Env } from '../../config/env.validation';
import type { PayOrderDto } from './dto/pay-order.dto';
import type { PaymentIntentDto } from './dto/payment-intent.dto';
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
  private readonly providerName: string;

  constructor(
    private readonly repo: PaymentsRepository,
    private readonly provider: PaymentProviderPort,
    private readonly orders: OrderPaymentPort,
    private readonly clock: Clock,
    config: ConfigService<Env, true>,
  ) {
    this.providerName = config.getOrThrow('PAYMENT_PROVIDER', { infer: true });
  }

  /** Start collecting. Safe to replay — the idempotency key finds its own attempt. */
  async pay(input: PayOrderDto): Promise<PaymentIntentDto> {
    const order = await this.requirePayable(input.orderId);
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
      accountId: null,
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
      statementDescriptor: null,
      idempotencyKey: input.idempotencyKey,
      status: started.status === 'failed' ? 'failed' : 'pending',
      now: this.clock.now(),
    });
    return this.toIntent(payment, order, started);
  }

  /**
   * A provider callback. Verified first — an unverified webhook is a stranger
   * claiming an order was paid — then processed exactly once by provider event
   * id, whatever retries or replicas do.
   */
  async handleWebhook(rawBody: Buffer, signature: string): Promise<WebhookAck> {
    const verified = this.provider.verifyWebhook(rawBody, signature);
    if (verified.type === 'ignored') return { received: true };
    const fresh = await this.repo.recordWebhook(this.providerName, verified);
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
    await this.dispatch(verified, payment);
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
    }
    await this.repo.markWebhookProcessed(
      verified.eventId,
      payment.organizationId,
      'processed',
    );
  }

  private async requirePayable(orderId: string): Promise<PayableOrder> {
    const order = await this.orders.findPayable(orderId);
    if (!order) throw DomainException.notFound("This order isn't available.");
    if (order.paymentStatus === 'paid') {
      throw DomainException.conflict('This order is already paid.');
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
      promptPayQr: started.promptPayQr,
      expiresAt: started.expiresAt?.toISOString() ?? null,
      declineReason: started.declineReason,
    };
  }
}
