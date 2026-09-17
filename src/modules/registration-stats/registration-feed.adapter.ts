import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, isNull } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { events, orders } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import type {
  FeedItem,
  FeedWindow,
} from '../notifications/ports/notification-feed.types';
import { RegistrationFeedPort } from '../notifications/ports/registration-feed.port';

/**
 * RegistrationStats' implementation of the feed's registration items
 * (US-MSG-03), so Notifications never reads the orders tables.
 *
 * CONFIRMED orders only. A pending one is a checkout somebody has not finished
 * and may never finish — announcing it as a new registration would be announcing
 * something that has not happened, and it would un-happen when the hold expired.
 *
 * No money on the item. An order's total is finance data, and a registration
 * item is shown to anyone with `regView`; carrying the amount would leak it to
 * exactly the readers US-MSG-03 says must not see money.
 */
@Injectable()
export class RegistrationFeedAdapter extends RegistrationFeedPort {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {
    super();
  }

  async recentRegistrations(
    organizationId: number,
    window: FeedWindow,
  ): Promise<FeedItem[]> {
    return withTenant(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select({
          id: orders.id,
          at: orders.registeredAt,
          eventId: events.id,
          eventName: events.name,
          personName: orders.buyerName,
          seats: orders.seats,
        })
        .from(orders)
        .innerJoin(events, eq(events.id, orders.eventId))
        .where(
          and(
            eq(orders.organizationId, organizationId),
            eq(orders.status, 'confirmed'),
            isNull(orders.deletedAt),
            gte(orders.registeredAt, window.since),
          ),
        )
        .orderBy(desc(orders.registeredAt))
        .limit(window.limit);

      return rows.map((row) => ({
        id: `order:${row.id}`,
        kind: 'registration' as const,
        at: row.at,
        eventId: row.eventId,
        eventName: row.eventName,
        personName: row.personName,
        amountSatang: null,
        seats: row.seats,
        reference: null,
      }));
    });
  }
}
