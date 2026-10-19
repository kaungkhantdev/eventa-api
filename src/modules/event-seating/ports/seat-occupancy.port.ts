import type { Tx } from '../../../db/tenant';

/**
 * Seating asks Registration which seats are taken right now, inside the seat
 * map's own transaction, so a row whose seats somebody booked or is checking out
 * with keeps its ticket type (US-EVT-05). Registration binds the adapter: the
 * seat holds and seat assignments are its tables.
 */
export abstract class SeatOccupancyPort {
  /**
   * Of `seatIds`, the ones booked (a seat assignment not yet released) or held
   * (an `active` hold that has not expired at `now`).
   */
  abstract occupiedSeatIdsIn(
    tx: Tx,
    organizationId: number,
    seatIds: number[],
    now: Date,
  ): Promise<Set<number>>;
}
