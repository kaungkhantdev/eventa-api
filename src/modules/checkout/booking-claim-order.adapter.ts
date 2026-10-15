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
 * The language follows the booking's own confirmation email. eventa-worker
 * writes that in the language of the attendee account using the buyer's
 * address, else the event's, else the workspace's. The first is skipped here.
 * A claim link never goes to an address with a confirmed account; it may go
 * to one whose only account is an Unconfirmed sign-up, which the claim then
 * takes over — but whoever made that sign-up proved nothing, so its language
 * is not taken as the address owner's. So it is the event's, else the
 * workspace's: the confirmation's own language, unless such a sign-up had
 * chosen another.
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
