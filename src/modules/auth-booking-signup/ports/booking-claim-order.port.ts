import type { Locale } from '../auth-booking-signup.types';

/** A booking, as far as creating its buyer's account needs to know it. */
export interface ClaimableBooking {
  orderId: string;
  buyerName: string;
  /** The address the booking — and so the claim link — was sent to. */
  buyerEmail: string;
  eventName: string;
  /**
   * The language this booking's own confirmation email is written in, so the
   * claim email that follows it speaks the same one.
   */
  locale: Locale;
}

/**
 * What creating an account from a booking (US-DISC-15) reads about the order.
 *
 * Declared here, by the consumer, and bound by Checkout, which owns orders —
 * so this module never reads `orders` or `events` itself. The order is found by
 * its uuid only, never by its human reference: the uuid is the unguessable
 * value the buyer's own order page is addressed by.
 */
export abstract class BookingClaimOrderPort {
  /** The booking with this order id, or null when there is none. */
  abstract findBooking(orderId: string): Promise<ClaimableBooking | null>;
}
