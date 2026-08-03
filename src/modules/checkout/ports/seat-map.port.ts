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
  abstract seatsForEvent(
    organizationId: number,
    eventId: string,
    now: Date,
  ): Promise<CheckoutSeat[]>;
}
