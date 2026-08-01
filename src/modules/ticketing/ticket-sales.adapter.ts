import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { ticketTypes } from '../../db/schema';
import { TicketSalesPort } from '../payment-settings/ports/ticket-sales.port';

/**
 * Ticketing's implementation of Payment Settings' TicketSalesPort — so that
 * module can ask "do we sell paid tickets?" without importing ticket tables.
 */
@Injectable()
export class TicketSalesAdapter extends TicketSalesPort {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {
    super();
  }

  /** True when the org has at least one live, non-free ticket type. */
  async hasPaidTickets(organizationId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ id: ticketTypes.id })
      .from(ticketTypes)
      .where(
        and(
          eq(ticketTypes.organizationId, organizationId),
          eq(ticketTypes.isFree, false),
          gt(ticketTypes.priceSatang, 0),
          isNull(ticketTypes.deletedAt),
        ),
      )
      .limit(1);
    return row !== undefined;
  }
}
