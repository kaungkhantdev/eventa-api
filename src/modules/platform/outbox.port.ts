/** A domain event to publish, written to the transactional outbox (Platform). */
export interface OutboxEventInput {
  organizationId: number;
  aggregateType: string;
  aggregateId: string;
  routingKey: string;
  payload: Record<string, unknown>;
}

/**
 * Abstraction over the transactional outbox. Domain services depend on this port
 * (DIP), not the concrete repository. `enqueue` writes an outbox_events row; the
 * relay publishes it to RabbitMQ.
 */
export abstract class OutboxPort {
  abstract enqueue(input: OutboxEventInput): Promise<void>;
}
