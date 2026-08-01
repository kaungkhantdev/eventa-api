import type { OutboxEventInput } from '../../platform/outbox.port';

/** Routing key for an organizer's "Email all attendees" broadcast request. */
export const EVENTS_ATTENDEES_EMAIL_REQUESTED =
  'events.attendees_email_requested';

export interface AttendeesEmailRequestedInput {
  organizationId: number;
  eventId: string;
  subject: string;
  message: string;
  requestedByUserId: string;
  /** Confirmed-attendee count when requested (informational; the worker re-resolves). */
  recipientCount: number;
  occurredAt: string;
}

/**
 * Builds the outbox entry for an "Email all attendees" broadcast (US-EVT-14). The
 * payload deliberately carries no recipient addresses — the Engagement worker (E12)
 * resolves the current confirmed attendees at send time (no PII on the bus, no
 * stale list) and delivers the message. `version` lets producer/consumer evolve apart.
 */
export function attendeesEmailRequestedEvent(
  input: AttendeesEmailRequestedInput,
): OutboxEventInput {
  return {
    organizationId: input.organizationId,
    aggregateType: 'event',
    aggregateId: input.eventId,
    routingKey: EVENTS_ATTENDEES_EMAIL_REQUESTED,
    payload: {
      version: 1,
      organizationId: input.organizationId,
      eventId: input.eventId,
      subject: input.subject,
      message: input.message,
      requestedByUserId: input.requestedByUserId,
      recipientCount: input.recipientCount,
      occurredAt: input.occurredAt,
    },
  };
}
