import { Injectable } from '@nestjs/common';
import {
  BookingClaimOrderPort,
  type ClaimableBooking,
} from '../auth-booking-signup/ports/booking-claim-order.port';
import { CheckoutRepository } from './checkout.repository';

/**
 * Checkout's answer to "which booking is this?" for an account created from it
 * (US-DISC-15). AuthBookingSignup declares the port; this adapter reads the
 * order — its status included, which Checkout alone sets — its event and its
 * workspace from the tables Checkout owns, so the account flow never touches
 * them.
 *
 * The language is the one the booking's own confirmation email is written in:
 * eventa-worker picks the buyer's account language first, then the event's,
 * then the workspace's. The first never applies here — a claim link is only
 * ever sent to an address with no account — so it is the event's, else the
 * workspace's, and the claim email reads in the same language as the ticket it
 * follows.
 */
@Injectable()
export class BookingClaimOrderAdapter extends BookingClaimOrderPort {
  constructor(private readonly repo: CheckoutRepository) {
    super();
  }

  async findBooking(orderId: string): Promise<ClaimableBooking | null> {
    const row = await this.repo.findClaimableBooking(orderId);
    if (!row) return null;
    return {
      orderId: row.orderId,
      buyerName: row.buyerName,
      buyerEmail: row.buyerEmail,
      eventName: row.eventName,
      locale: row.eventLocale ?? row.organizationLocale,
      status: row.status,
    };
  }
}
