import { Inject, Injectable } from '@nestjs/common';
import { and, inArray, isNull, lte } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/drizzle.constants';
import { outboxEvents } from '../db/schema';
import { OutboxReaderPort, type OutboxRow } from './outbox-reader.port';

/** Drizzle-backed outbox reader. */
@Injectable()
export class OutboxReader extends OutboxReaderPort {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {
    super();
  }

  async fetchBatch(limit: number): Promise<OutboxRow[]> {
    return this.db
      .select({
        id: outboxEvents.id,
        organizationId: outboxEvents.organizationId,
        routingKey: outboxEvents.routingKey,
        payload: outboxEvents.payload,
      })
      .from(outboxEvents)
      .where(
        and(
          isNull(outboxEvents.publishedAt),
          lte(outboxEvents.availableAt, new Date()),
        ),
      )
      .orderBy(outboxEvents.id)
      .limit(limit);
  }

  async markPublished(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .update(outboxEvents)
      .set({ publishedAt: new Date() })
      .where(inArray(outboxEvents.id, ids));
  }
}
