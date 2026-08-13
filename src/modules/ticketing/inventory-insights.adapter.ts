import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { ticketTypes } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import { InventoryInsightsPort } from '../dashboard/ports/operations-insights.port';

/**
 * A tier is "selling fast" once this percentage of its allocation is gone.
 * Named here, in Ticketing, because Ticketing owns what running low means — the
 * dashboard only renders the count it is given (US-DASH-06/11).
 */
const LOW_STOCK_PERCENT = 80;
const FULL = 100;
/** An allocation of 0 means unlimited — mirrors `TicketingPolicy`. */
const UNLIMITED = 0;
const ON_SALE = 'onsale';

/**
 * Ticketing's implementation of the Dashboard-owned inventory port, so the
 * home screen can warn about a coming sell-out without reading `ticket_types`.
 *
 * Only tiers actually ON SALE count: a paused or scheduled tier is not selling
 * out, it is simply not selling, and alerting on it would be noise. Unlimited
 * allocations are excluded for the same reason — they cannot run out.
 */
@Injectable()
export class InventoryInsightsAdapter extends InventoryInsightsPort {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {
    super();
  }

  async countSellingOut(organizationId: number): Promise<number> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(ticketTypes)
        .where(
          and(
            eq(ticketTypes.organizationId, organizationId),
            eq(ticketTypes.status, ON_SALE),
            gt(ticketTypes.total, UNLIMITED),
            // Cross-multiplied so both sides stay INTEGER: a fractional
            // threshold arrives as an untyped parameter and Postgres cannot
            // resolve `integer * unknown`, which fails the whole query.
            sql`${ticketTypes.sold} * ${FULL} >= ${ticketTypes.total} * ${LOW_STOCK_PERCENT}`,
          ),
        );
      return row.count;
    });
  }
}
