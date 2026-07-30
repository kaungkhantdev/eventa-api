import type { OutboxEventInput } from '../../platform/outbox.port';

/** Routing key for a cancellation (consumed by eventa-worker: refunds, notices). */
export const EVENTS_CANCELLED = 'events.cancelled';

export interface EventCancelledInput {
  organizationId: number;
  eventId: string;
  slug: string;
  name: string;
  reason: string;
  cancelledBy: string;
  occurredAt: string;
}

/**
 * Builds the outbox entry for a cancellation. The worker fans this out into the
 * side effects US-EVT-08 requires — void the waitlist, invalidate issued tickets,
 * queue refunds for paid attendees, and message affected attendees in their
 * language. `version` lets producer/consumer evolve apart.
 */
export function eventCancelledEvent(
  input: EventCancelledInput,
): OutboxEventInput {
  return {
    organizationId: input.organizationId,
    aggregateType: 'event',
    aggregateId: input.eventId,
    routingKey: EVENTS_CANCELLED,
    payload: {
      version: 1,
      organizationId: input.organizationId,
      eventId: input.eventId,
      slug: input.slug,
      name: input.name,
      reason: input.reason,
      cancelledBy: input.cancelledBy,
      occurredAt: input.occurredAt,
    },
  };
}
