import type { OutboxEventInput } from '../../platform/outbox.port';

/** Routing key for a sign-up the organizer turned down. */
export const REGISTRATION_REJECTED = 'registration.rejected';

export interface RegistrationRejectedInput {
  organizationId: number;
  orderId: string;
  reference: string;
  eventId: string;
  buyerEmail: string;
  buyerName: string;
  /** The organizer's note, if they left one. Shown to nobody but the organizer. */
  reason: string | null;
  occurredAt: string;
}

/**
 * Builds the outbox entry for US-REG-02's rejection notice: "a rejection notice
 * is emailed to the attendee". Queued in the SAME transaction that releases the
 * seat, so a freed seat and the message telling its owner commit together.
 *
 * `reason` travels for the organizer's own audit trail; the notice itself is
 * deliberately not obliged to repeat it back to the attendee.
 */
export function registrationRejectedEvent(
  input: RegistrationRejectedInput,
): OutboxEventInput {
  return {
    organizationId: input.organizationId,
    aggregateType: 'order',
    aggregateId: input.orderId,
    routingKey: REGISTRATION_REJECTED,
    payload: {
      version: 1,
      organizationId: input.organizationId,
      orderId: input.orderId,
      reference: input.reference,
      eventId: input.eventId,
      buyerEmail: input.buyerEmail,
      buyerName: input.buyerName,
      reason: input.reason,
      occurredAt: input.occurredAt,
    },
  };
}
