import type { seatHolds } from '../../db/schema';

/** A selected `seat_holds` row. */
export type SeatHoldRow = typeof seatHolds.$inferSelect;

/** The authenticated tenant slice the hold engine needs. */
export interface SeatHoldActor {
  organizationId: number;
}

/** Reserve specific seats from an event's seat map (reserved seating). */
export interface HoldSeatsInput {
  eventId: string;
  seatIds: number[];
  /** The pending order these holds back; omit for a cart-only hold. */
  orderId?: string;
}

/** Reserve a quantity against a general-admission ticket tier. */
export interface HoldQuantityInput {
  eventId: string;
  ticketTypeId: string;
  quantity: number;
  orderId?: string;
}

/**
 * Outcome of a reserved-seat hold. `unavailableSeatIds` names every seat that
 * blocked the (all-or-nothing) request — sold, blocked, already held, or gone.
 */
export type HoldSeatsResult =
  | { ok: true; holds: SeatHoldRow[] }
  | { ok: false; unavailableSeatIds: number[] };

/** Outcome of a GA quantity hold; `available` is what remained when it failed. */
export type HoldQuantityResult =
  { ok: true; hold: SeatHoldRow } | { ok: false; available: number };
