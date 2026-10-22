import type { OutboxEventInput } from '../../platform/outbox.port';
import { PAYMENT_REFUND_REQUIRED } from '../../../common/constants/checkout.constants';

export interface RefundRequiredInput {
  organizationId: number;
  orderId: string;
  reference: string;
  eventId: string;
  buyerEmail: string;
  amountSatang: number;
  currency: string;
  /**
   * A code (`soldout`, `duplicate_payment`, …), never a sentence: the buyer's
   * email is in their language, and eventa-worker words the code for them.
   */
  reason: string;
  occurredAt: string;
}

/**
 * Builds the outbox entry for the losing side of a settlement race
 * (US-DISC-06: "the other is not charged, or is refunded"): the buyer paid, but
 * their seats were taken or the tier sold out while the money was in flight.
 * The order is cancelled in the same transaction; this event is how the money
 * finds its way back — the finance side (E9) consumes it and issues the refund.
 */
export function refundRequiredEvent(
  input: RefundRequiredInput,
): OutboxEventInput {
  return {
    organizationId: input.organizationId,
    aggregateType: 'order',
    aggregateId: input.orderId,
    routingKey: PAYMENT_REFUND_REQUIRED,
    payload: {
      version: 1,
      organizationId: input.organizationId,
      orderId: input.orderId,
      reference: input.reference,
      eventId: input.eventId,
      buyerEmail: input.buyerEmail,
      amountSatang: input.amountSatang,
      currency: input.currency,
      reason: input.reason,
      occurredAt: input.occurredAt,
    },
  };
}
