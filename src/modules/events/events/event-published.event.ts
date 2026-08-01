import type { OutboxEventInput } from '../../platform/outbox.port';

/** Routing key for the "event published" notice (consumed by eventa-worker). */
export const EVENTS_PUBLISHED = 'events.published';

export interface EventPublishedInput {
  organizationId: number;
  eventId: string;
  slug: string;
  name: string;
  publishedBy: string;
  occurredAt: string;
}

/**
 * Builds the outbox entry for a publish. The worker turns it into the team's
 * "Event published" notification. `version` lets producer/consumer evolve apart.
 */
export function eventPublishedEvent(
  input: EventPublishedInput,
): OutboxEventInput {
  return {
    organizationId: input.organizationId,
    aggregateType: 'event',
    aggregateId: input.eventId,
    routingKey: EVENTS_PUBLISHED,
    payload: {
      version: 1,
      organizationId: input.organizationId,
      eventId: input.eventId,
      slug: input.slug,
      name: input.name,
      publishedBy: input.publishedBy,
      occurredAt: input.occurredAt,
    },
  };
}
