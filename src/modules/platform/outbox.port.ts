import type { Tx } from '../../db/tenant';

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

  /**
   * Enqueue inside a transaction the caller already opened — what makes the
   * outbox *transactional* rather than a second write that can be lost. Use this
   * wherever the event must live or die with the rows beside it: an order that
   * commits without its confirmation email is a customer with no ticket, and an
   * email for an order that rolled back is worse. `Tx` is the shared database
   * handle from `src/db`, not another module's internals.
   */
  abstract enqueueIn(tx: Tx, input: OutboxEventInput): Promise<void>;
}
