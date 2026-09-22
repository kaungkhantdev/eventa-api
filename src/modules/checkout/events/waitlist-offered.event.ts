import type { OutboxEventInput } from '../../platform/outbox.port';

/** Routing key for a seat offered to someone on the waitlist (US-REG-04). */
export const WAITLIST_OFFERED = 'waitlist.offered';

export interface WaitlistOfferedInput {
  organizationId: number;
  orderId: string;
  reference: string;
  eventId: string;
  buyerEmail: string;
  buyerName: string;
  ticketTypeName: string;
  ticketCount: number;
  totalSatang: number;
  currency: string;
  /** When the offer lapses and the seat passes to the next in line. */
  offerExpiresAt: Date;
  /** ABSOLUTE link to the order page, where the offer is paid for. */
  payUrl: string;
  occurredAt: Date;
}

/**
 * Builds the outbox entry for the waitlist offer (US-REG-04: "they receive a
 * time-limited offer … and are notified"). Written in the SAME transaction
 * that turns the registration `pending`, so an offer and the email about it
 * commit together.
 *
 * eventa-worker writes this same shape itself when it passes a lapsed offer to
 * the next person — keep the two in step.
 */
export function waitlistOfferedEvent(
  input: WaitlistOfferedInput,
): OutboxEventInput {
  return {
    organizationId: input.organizationId,
    aggregateType: 'order',
    aggregateId: input.orderId,
    routingKey: WAITLIST_OFFERED,
    payload: {
      version: 1,
      organizationId: input.organizationId,
      orderId: input.orderId,
      reference: input.reference,
      eventId: input.eventId,
      buyerEmail: input.buyerEmail,
      buyerName: input.buyerName,
      ticketTypeName: input.ticketTypeName,
      ticketCount: input.ticketCount,
      totalSatang: input.totalSatang,
      currency: input.currency,
      offerExpiresAt: input.offerExpiresAt.toISOString(),
      payUrl: input.payUrl,
      occurredAt: input.occurredAt.toISOString(),
    },
  };
}
