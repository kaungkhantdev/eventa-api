import type { Tx } from '../../../db/tenant';

/** A live ticket type a seat row can be given (US-EVT-05). */
export interface SeatTier {
  id: string;
  name: string;
}

/**
 * Seating's way to read the ticket types its rows sell, and to make each one's
 * quantity the seats its rows hold, INSIDE the seat map's own transaction — so
 * the seats and the quantities commit or roll back together (US-EVT-05). Seating
 * owns the abstraction; Ticketing binds the adapter, because `ticket_types` is
 * its table and only it knows what a quantity below `sold` means. Same shape as
 * Checkout's `RedemptionLedgerPort.redeemIn`.
 */
export abstract class TicketQuantityPort {
  /** The event's live ticket types, row-locked in id order. */
  abstract lockLiveTiersIn(
    tx: Tx,
    organizationId: number,
    eventId: string,
  ): Promise<SeatTier[]>;

  /**
   * Sets every live ticket type's quantity to its seats (0 for one with no
   * rows) and re-derives its status. Throws a 409 when that would leave a type
   * with fewer seats than it has sold, which rolls the whole save back.
   */
  abstract setSeatQuantitiesIn(
    tx: Tx,
    organizationId: number,
    eventId: string,
    seatsByTier: ReadonlyMap<string, number>,
  ): Promise<void>;

  /** The event's live ticket types, read outside a save (the publish gate). */
  abstract liveTiers(
    organizationId: number,
    eventId: string,
  ): Promise<SeatTier[]>;
}
