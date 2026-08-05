import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/time/clock';
import { DomainException } from '../../common/errors/domain.exception';
import type { Tx } from '../../db/tenant';
import {
  OrderPaymentPort,
  type PayableOrder,
  type SettlementResult,
} from '../payments/ports/order-payment.port';
import { CheckoutRepository, type OrderRow } from './checkout.repository';
import { registrationConfirmedEvent } from './events/registration-confirmed.event';
import { refundRequiredEvent } from './events/refund-required.event';
import { generateQrToken } from './order-reference';
import { CheckoutEventPort } from './ports/checkout-event.port';

/**
 * Checkout's implementation of the Payments-owned order port (US-DISC-05).
 * Payments asks "what order is this?", "the money arrived — complete it", and
 * "the code lapsed — let the seats go"; this adapter answers from the tables
 * Checkout owns, so the payment flow never reads orders or tickets itself.
 */
@Injectable()
export class OrderPaymentAdapter extends OrderPaymentPort {
  constructor(
    private readonly repo: CheckoutRepository,
    private readonly events: CheckoutEventPort,
    private readonly clock: Clock,
  ) {
    super();
  }

  async findPayable(orderId: string): Promise<PayableOrder | null> {
    const order = await this.repo.findOrderAnyTenant(orderId);
    if (!order) return null;
    return {
      id: order.id,
      organizationId: order.organizationId,
      reference: order.reference,
      eventId: order.eventId,
      buyerName: order.buyerName,
      buyerEmail: order.buyerEmail,
      status: order.status,
      paymentStatus: order.paymentStatus,
      totalSatang: order.totalSatang,
      currency: order.currency,
    };
  }

  async settle(
    organizationId: number,
    orderId: string,
    recordPayment: (tx: Tx) => Promise<void>,
  ): Promise<SettlementResult> {
    const order = await this.repo.orderById(organizationId, orderId);
    if (!order) throw DomainException.notFound("This order isn't available.");
    // Resolved before the transaction opens — no cross-connection reads while
    // holding row locks. An event unpublished mid-payment still settles; only
    // the email's "join link" note depends on this, and false is the safe side.
    const isOnline =
      (await this.events.findPublishedById(order.eventId))?.isOnline ?? false;
    const now = this.clock.now();
    return this.repo.settleOrder({
      organizationId,
      orderId,
      mintQrToken: generateQrToken,
      buildConfirmedEvent: (settled, ticketCount) =>
        this.confirmedEvent(settled, ticketCount, isOnline, now),
      buildRefundEvent: (refused, reason) =>
        refundRequiredEvent({
          organizationId,
          orderId: refused.id,
          reference: refused.reference,
          eventId: refused.eventId,
          buyerEmail: refused.buyerEmail,
          amountSatang: refused.totalSatang,
          currency: refused.currency,
          reason,
          occurredAt: now.toISOString(),
        }),
      recordPayment,
      now,
    });
  }

  releaseHolds(organizationId: number, orderId: string): Promise<void> {
    return this.repo.releaseHoldsForOrder(organizationId, orderId);
  }

  /**
   * A second payment settled an order the first already paid for. The tickets
   * stand; this money goes back, through the same `payment.refund_required`
   * contract the inventory-conflict path uses.
   */
  async queueRefund(
    organizationId: number,
    orderId: string,
    input: { amountSatang: number; reason: string },
  ): Promise<void> {
    const order = await this.repo.orderById(organizationId, orderId);
    if (!order) throw DomainException.notFound("This order isn't available.");
    await this.repo.enqueueRefund(
      organizationId,
      refundRequiredEvent({
        organizationId,
        orderId: order.id,
        reference: order.reference,
        eventId: order.eventId,
        buyerEmail: order.buyerEmail,
        amountSatang: input.amountSatang,
        currency: order.currency,
        reason: input.reason,
        occurredAt: this.clock.now().toISOString(),
      }),
    );
  }

  private confirmedEvent(
    order: OrderRow,
    ticketCount: number,
    isOnline: boolean,
    now: Date,
  ) {
    return registrationConfirmedEvent({
      organizationId: order.organizationId,
      orderId: order.id,
      reference: order.reference,
      eventId: order.eventId,
      buyerEmail: order.buyerEmail,
      buyerName: order.buyerName,
      buyerPhone: order.buyerPhone,
      ticketCount,
      totalSatang: order.totalSatang,
      vatSatang: order.vatAmountSatang,
      currency: order.currency,
      isOnline,
      paid: true,
      occurredAt: now.toISOString(),
    });
  }
}
