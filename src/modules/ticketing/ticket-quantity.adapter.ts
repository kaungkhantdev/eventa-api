import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/time/clock';
import type { Tx } from '../../db/tenant';
import {
  type SeatTier,
  TicketQuantityPort,
} from '../event-seating/ports/ticket-quantity.port';
import { TicketingPolicy } from './ticketing.policy';
import { TicketingRepository } from './ticketing.repository';
import type { TicketRow } from './ticketing.types';

/**
 * Ticketing's implementation of Seating's `TicketQuantityPort` (US-EVT-05): on
 * a reserved event whose seats have ticket types, each type's quantity is the
 * seats it holds, written in the seat map's own transaction. The status is
 * re-derived exactly as a quantity edit re-derives it, so more seats put a
 * sold-out type back on sale and fewer can sell one out.
 */
@Injectable()
export class TicketQuantityAdapter extends TicketQuantityPort {
  constructor(
    private readonly repo: TicketingRepository,
    private readonly policy: TicketingPolicy,
    private readonly clock: Clock,
  ) {
    super();
  }

  async lockLiveTiersIn(
    tx: Tx,
    organizationId: number,
    eventId: string,
  ): Promise<SeatTier[]> {
    const tiers = await this.repo.lockLiveByEventIn(
      tx,
      organizationId,
      eventId,
    );
    return tiers.map(toSeatTier);
  }

  /** Every type is checked before any is written, so a refusal changes nothing. */
  async setSeatQuantitiesIn(
    tx: Tx,
    organizationId: number,
    eventId: string,
    seatsByTier: ReadonlyMap<string, number>,
  ): Promise<void> {
    const tiers = await this.repo.lockLiveByEventIn(
      tx,
      organizationId,
      eventId,
    );
    const seatsOf = (t: TicketRow) => seatsByTier.get(t.id) ?? 0;
    for (const t of tiers) {
      this.policy.assertSeatsCoverSold(t.name, t.sold, seatsOf(t));
    }
    const now = this.clock.now();
    for (const t of tiers.filter((tier) => seatsOf(tier) !== tier.total)) {
      const total = seatsOf(t);
      const status = this.policy.resolveStatus({ ...t, total }, now);
      await this.repo.setTotalIn(tx, organizationId, t.id, total, status);
    }
  }

  async liveTiers(
    organizationId: number,
    eventId: string,
  ): Promise<SeatTier[]> {
    const tiers = await this.repo.listByEvent(organizationId, eventId);
    return tiers.map(toSeatTier);
  }
}

function toSeatTier(t: TicketRow): SeatTier {
  return { id: t.id, name: t.name };
}
