import { Injectable } from '@nestjs/common';
import type { Tx } from '../../db/tenant';
import { SeatOccupancyPort } from '../event-seating/ports/seat-occupancy.port';
import { SeatHoldRepository } from './seat-hold.repository';

/**
 * Registration's implementation of Seating's `SeatOccupancyPort` (US-EVT-05):
 * the holds and assignments are its tables, and the hold engine already knows
 * what "taken right now" means — one answer, not two that can drift apart.
 */
@Injectable()
export class SeatOccupancyAdapter extends SeatOccupancyPort {
  constructor(private readonly repo: SeatHoldRepository) {
    super();
  }

  occupiedSeatIdsIn(
    tx: Tx,
    organizationId: number,
    seatIds: number[],
    now: Date,
  ): Promise<Set<number>> {
    return this.repo.occupiedSeatIdsIn(tx, organizationId, seatIds, now);
  }
}
