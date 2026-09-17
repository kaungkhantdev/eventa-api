import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, isNotNull } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { events, payouts } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import type {
  FeedItem,
  FeedWindow,
} from '../notifications/ports/notification-feed.types';
import { PayoutFeedPort } from '../notifications/ports/payout-feed.port';

/**
 * Payouts' implementation of the feed's transfer items (US-MSG-03).
 *
 * Only `paid` ones, and only once `completed_at` is stamped. A payout that is
 * scheduled or processing has not reached the bank, and a feed records what HAS
 * happened — work in flight belongs on the payouts screen, where it can be acted
 * on.
 *
 * A failed payout is deliberately absent: it is not news that arrives once, it
 * is a standing problem with a retry button, and the payouts screen is where the
 * organizer fixes it.
 *
 * The event is joined LEFT, because a payout may settle several events at once
 * and carries no event of its own.
 */
@Injectable()
export class PayoutFeedAdapter extends PayoutFeedPort {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {
    super();
  }

  async recentPayouts(
    organizationId: number,
    window: FeedWindow,
  ): Promise<FeedItem[]> {
    return withTenant(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select({
          id: payouts.id,
          at: payouts.completedAt,
          amountSatang: payouts.amountSatang,
          reference: payouts.reference,
          eventId: events.id,
          eventName: events.name,
        })
        .from(payouts)
        .leftJoin(events, eq(events.id, payouts.eventId))
        .where(
          and(
            eq(payouts.organizationId, organizationId),
            eq(payouts.status, 'paid'),
            isNotNull(payouts.completedAt),
            gte(payouts.completedAt, window.since),
          ),
        )
        .orderBy(desc(payouts.completedAt))
        .limit(window.limit);

      return rows.flatMap((row) =>
        // `completed_at` is filtered above; the guard is here to satisfy the
        // type rather than to handle a case that can occur.
        row.at === null
          ? []
          : [
              {
                id: `payout:${row.id}`,
                kind: 'payout' as const,
                at: row.at,
                eventId: row.eventId,
                eventName: row.eventName,
                // Nobody is named: the money went to the workspace's own bank.
                personName: null,
                amountSatang: row.amountSatang,
                seats: null,
                reference: row.reference,
              },
            ],
      );
    });
  }
}
