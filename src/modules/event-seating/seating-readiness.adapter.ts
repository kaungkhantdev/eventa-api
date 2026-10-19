import { Injectable } from '@nestjs/common';
import {
  type SeatRowsReadiness,
  SeatingReadinessPort,
} from '../events/ports/seating-readiness.port';
import { toSeatRows } from './event-seating.mapper';
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

  async seatRowsReadiness(
    organizationId: number,
    eventId: string,
  ): Promise<SeatRowsReadiness> {
    const map = await this.repo.findMap(organizationId, eventId);
    const counts = map
      ? await this.repo.rowTypeCounts(organizationId, map.id)
      : [];
    const tiers = await this.tiers.liveTiers(organizationId, eventId);
    return this.policy.readiness(toSeatRows(counts), tiers);
  }
}
