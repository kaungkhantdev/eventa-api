import type { OutboxEventInput } from '../../platform/outbox.port';

/** Routing key for a placed, fully-paid registration (US-DISC-06). */
export const REGISTRATION_CONFIRMED = 'registration.confirmed';

export interface RegistrationConfirmedInput {
  organizationId: number;
  orderId: string;
  reference: string;
  eventId: string;
  buyerEmail: string;
  buyerName: string;
  /** Present only when the buyer gave one — drives the confirmation SMS. */
  buyerPhone: string | null;
  ticketCount: number;
  totalSatang: number;
  vatSatang: number;
  currency: string;
  /** True when the event is online, so the worker includes the join link. */
  isOnline: boolean;
  /** True once money changed hands — a free RSVP gets no VAT receipt. */
  paid: boolean;
  /**
   * ABSOLUTE link to the buyer's tickets. Built here, from `PUBLIC_WEB_URL`,
   * exactly as `verifyUrl`/`resetUrl` are — the worker has no notion of the
   * web origin, and a relative path is inert in an email client.
   */
  ticketsUrl: string;
  occurredAt: string;
}

/**
 * Builds the outbox entry for a confirmed registration (US-DISC-06): the
 * confirmation email with its QR tickets, order summary, VAT receipt and
 * calendar invite, plus the SMS when a mobile number was given.
 *
 * Written in the SAME transaction as the order and its tickets — an order that
 * commits without this event is an attendee holding nothing, and this event
 * without the order would promise a ticket that does not exist.
 *
 * The payload deliberately carries no QR tokens. They are bearer credentials for
 * admission; the worker reads the current, unrevoked tickets when it renders the
 * email, so a token never sits on the bus or in a retry queue.
 */
export function registrationConfirmedEvent(
  input: RegistrationConfirmedInput,
): OutboxEventInput {
  return {
    organizationId: input.organizationId,
    aggregateType: 'order',
    aggregateId: input.orderId,
    routingKey: REGISTRATION_CONFIRMED,
    payload: {
      version: 1,
      organizationId: input.organizationId,
      orderId: input.orderId,
      reference: input.reference,
      eventId: input.eventId,
      buyerEmail: input.buyerEmail,
      buyerName: input.buyerName,
      buyerPhone: input.buyerPhone,
      ticketCount: input.ticketCount,
      totalSatang: input.totalSatang,
      vatSatang: input.vatSatang,
      currency: input.currency,
      isOnline: input.isOnline,
      paid: input.paid,
      ticketsUrl: input.ticketsUrl,
      occurredAt: input.occurredAt,
    },
  };
}
