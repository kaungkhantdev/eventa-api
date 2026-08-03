import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { outboxEvents } from '../../db/schema';
import type { Tx } from '../../db/tenant';
import { OutboxPort, type OutboxEventInput } from './outbox.port';

/** Writes domain events to the transactional outbox; the relay publishes them. */
@Injectable()
export class OutboxRepository extends OutboxPort {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {
    super();
  }

  async enqueue(input: OutboxEventInput): Promise<void> {
    await this.enqueueIn(this.db, input);
  }

  async enqueueIn(tx: Tx | Database, input: OutboxEventInput): Promise<void> {
    await tx.insert(outboxEvents).values({
      organizationId: input.organizationId,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      routingKey: input.routingKey,
      payload: input.payload,
    });
  }
}
