import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/time/clock';
import type { CheckoutTier } from '../checkout/checkout.types';
import { TicketCatalogPort } from '../checkout/ports/ticket-catalog.port';
import { TicketingPolicy } from './ticketing.policy';
import { TicketingRepository } from './ticketing.repository';
import type { TicketRow } from './ticketing.types';

/**
 * Ticketing's implementation of the Checkout-owned catalog port (US-DISC-04).
 *
 * The `status` it hands back is DERIVED here, not read from the row: a tier that
 * has just sold its last seat, or whose window opened a minute ago, must present
 * to a buyer as sold out or on sale immediately — the same rule the organizer's
 * own screens use (US-TKT-03), applied at the till.
 */
@Injectable()
export class CheckoutCatalogAdapter extends TicketCatalogPort {
  constructor(
    private readonly repo: TicketingRepository,
    private readonly policy: TicketingPolicy,
    private readonly clock: Clock,
  ) {
    super();
  }

  async tiersForEvent(
    organizationId: number,
    eventId: string,
  ): Promise<CheckoutTier[]> {
    const rows = await this.repo.listByEvent(organizationId, eventId);
    return rows.map((row) => this.toTier(row));
  }

  async tierById(
    organizationId: number,
    eventId: string,
    ticketTypeId: string,
  ): Promise<CheckoutTier | null> {
    const row = await this.repo.findTicket(
      organizationId,
      eventId,
      ticketTypeId,
    );
    return row ? this.toTier(row) : null;
  }

  private toTier(row: TicketRow): CheckoutTier {
    return {
      id: row.id,
      name: row.name,
      priceSatang: row.priceSatang,
      isFree: row.isFree,
      status: this.policy.resolveStatus(row, this.clock.now()),
      admissionType: row.admissionType,
      salesStartAt: row.salesStartAt,
      salesEndAt: row.salesEndAt,
      minPerOrder: row.minPerOrder,
      maxPerOrder: row.maxPerOrder,
      sold: row.sold,
      total: row.total,
    };
  }
}
