import type { CheckoutSeat } from '../checkout.types';

/**
 * Checkout's read-only view of a reserved-seating map: every seat, and whether it
 * can be picked right now. Checkout owns the abstraction (DIP); the Registration
 * module binds the adapter, because "free right now" folds in the live seat holds
 * and assignments that the hold engine already owns — keeping one answer to that
 * question rather than two that can disagree.
 *
 * This is a READ for drawing the map. It settles nothing: a seat shown as
 * available may still be taken between the draw and the hold, which is why the
 * reservation transaction re-checks under a row lock and is the only authority.
 */
export abstract class SeatMapPort {
  /**
   * `ownHoldIds` are the caller's own reservations, and they do NOT make a seat
   * unavailable — availability here means "available to you". Without it a buyer
   * who has just held seat 4 would be told seat 4 was taken, by themselves, the
   * moment they tried to confirm.
   */
  abstract seatsForEvent(
    organizationId: number,
    eventId: string,
    now: Date,
    ownHoldIds?: number[],
  ): Promise<CheckoutSeat[]>;
}
