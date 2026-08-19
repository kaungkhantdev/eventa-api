import { Injectable } from '@nestjs/common';
import {
  type TicketEligibility,
  TicketEligibilityPort,
} from '../registration/ports/ticket-eligibility.port';
import { TicketingRepository } from './ticketing.repository';
import type { TicketRow } from './ticketing.types';

/** Project a full tier row down to the checkout's sales-eligibility view. */
const toEligibility = (row: TicketRow): TicketEligibility => ({
  status: row.status,
  salesStartAt: row.salesStartAt,
  salesEndAt: row.salesEndAt,
  minPerOrder: row.minPerOrder,
  maxPerOrder: row.maxPerOrder,
});

/**
 * Ticketing's implementation of the Registration-owned `TicketEligibilityPort`: it reads
 * `ticket_types` (which it owns) and hands back only the sales-eligibility fields,
 * so the reservation/checkout layer never touches the Ticketing tables.
 */
@Injectable()
export class TicketEligibilityAdapter extends TicketEligibilityPort {
  constructor(private readonly repo: TicketingRepository) {
    super();
  }

  async getEligibility(
    organizationId: number,
    eventId: string,
    ticketTypeId: string,
  ): Promise<TicketEligibility | null> {
    const row = await this.repo.findTicket(
      organizationId,
      eventId,
      ticketTypeId,
    );
    return row ? toEligibility(row) : null;
  }

  async getEligibilityByIds(
    organizationId: number,
    ticketTypeIds: string[],
  ): Promise<Map<string, TicketEligibility>> {
    const rows = await this.repo.findByIds(organizationId, ticketTypeIds);
    return new Map(rows.map((row) => [row.id, toEligibility(row)]));
  }
}
