import { Injectable } from '@nestjs/common';
import {
  type SeatsReadiness,
  SeatingReadinessPort,
} from '../events/ports/seating-readiness.port';
import { EventSeatingPolicy } from './event-seating.policy';
import { EventSeatingRepository } from './event-seating.repository';
import { TicketQuantityPort } from './ports/ticket-quantity.port';

/**
 * Seating's implementation of Events' `SeatingReadinessPort` (US-EVT-05): the
 * publish gate's question about a reserved map, answered from the seats this
 * module owns and the event's live ticket types.
 */
@Injectable()
export class SeatingReadinessAdapter extends SeatingReadinessPort {
  constructor(
    private readonly repo: EventSeatingRepository,
    private readonly tiers: TicketQuantityPort,
    private readonly policy: EventSeatingPolicy,
  ) {
    super();
  }

  async seatsReadiness(
    organizationId: number,
    eventId: string,
  ): Promise<SeatsReadiness> {
    const map = await this.repo.findMap(organizationId, eventId);
    const seats = map ? await this.repo.seatTypes(organizationId, map.id) : [];
    const tiers = await this.tiers.liveTiers(organizationId, eventId);
    return this.policy.readiness(
      seats.map((s) => s.ticketTypeId),
      tiers,
    );
  }
}
