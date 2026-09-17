import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { events, payments } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import type {
  FeedItem,
  FeedWindow,
} from '../notifications/ports/notification-feed.types';
import { PaymentFeedPort } from '../notifications/ports/payment-feed.port';

/**
 * Payments' implementation of the feed's money items (US-MSG-03).
 *
 * One scan for both outcomes. A settled payment is a `payment` item and a
 * declined one is an `alert` — the kit's own classification, and the distinction
 * belongs here because only this module knows what its own statuses mean.
 *
 * The two are stamped differently on purpose: a settled payment happened when it
 * settled, while a declined one never settled at all, so its time is when the
 * attempt was made. `coalesce` picks whichever exists, and the window and the
 * ordering both use it, so a decline cannot sort into the wrong day.
 */
@Injectable()
export class PaymentFeedAdapter extends PaymentFeedPort {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {
    super();
  }

  async recentPayments(
    organizationId: number,
    window: FeedWindow,
  ): Promise<FeedItem[]> {
    return withTenant(this.db, organizationId, async (tx) => {
      const happenedAt = sql<Date>`coalesce(${payments.paidAt}, ${payments.createdAt})`;
      const rows = await tx
        .select({
          id: payments.id,
          status: payments.status,
          at: happenedAt,
          amountSatang: payments.amountSatang,
          personName: payments.payerName,
          eventId: events.id,
          eventName: events.name,
        })
        .from(payments)
        .innerJoin(events, eq(events.id, payments.eventId))
        .where(
          and(
            eq(payments.organizationId, organizationId),
            // Nothing pending: a charge in flight is not news until it lands
            // one way or the other.
            sql`${payments.status} IN ('paid', 'failed')`,
            gte(happenedAt, window.since),
          ),
        )
        .orderBy(desc(happenedAt))
        .limit(window.limit);

      return rows.map((row) => ({
        id: `payment:${row.id}`,
        kind: row.status === 'paid' ? ('payment' as const) : ('alert' as const),
        at: new Date(row.at),
        eventId: row.eventId,
        eventName: row.eventName,
        personName: row.personName,
        amountSatang: row.amountSatang,
        seats: null,
        reference: null,
      }));
    });
  }
}
