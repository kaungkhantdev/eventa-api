import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';

export interface OutboxBacklog {
  /** Rows written but not yet published to RabbitMQ. */
  unpublished: number;
  /** Age in seconds of the OLDEST unpublished row; 0 when there are none. */
  oldestAgeSeconds: number;
}

/**
 * The relay's health, measured from the only place that cannot lie about it —
 * the table it is supposed to be draining (devops-observability-sre.md §2).
 *
 * `eventa-infra/README.md` states the case: a liveness probe on the relay is
 * green while it runs and publishes nothing, and every order still succeeds, so
 * the platform looks healthy while no email leaves it. Backlog age is what
 * actually moves when the relay stops.
 *
 * Age rather than count. A count is meaningless without a rate — a thousand
 * rows written in a burst and drained in a second is fine, ten rows stuck for
 * an hour is an outage — and it is the second one that costs somebody a ticket.
 *
 * Deliberately NOT tenant-scoped: this is a platform signal, read outside any
 * request, and `withTenant` would scope it to whoever happened to ask.
 */
@Injectable()
export class OutboxLagRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async backlog(): Promise<OutboxBacklog> {
    // One pass, two answers. `coalesce` so an empty backlog reads as a real
    // zero rather than a null the caller has to interpret.
    const result = await this.db.execute<{
      unpublished: string | number;
      oldest_age_seconds: string | number;
    }>(sql`
      SELECT
        count(*) AS unpublished,
        coalesce(extract(epoch FROM now() - min(created_at)), 0) AS oldest_age_seconds
      FROM outbox_events
      WHERE published_at IS NULL
    `);
    const row = result.rows?.[0];
    return {
      unpublished: Number(row?.unpublished ?? 0),
      oldestAgeSeconds: Number(row?.oldest_age_seconds ?? 0),
    };
  }
}
