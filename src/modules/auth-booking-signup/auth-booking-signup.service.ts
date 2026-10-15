import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import {
  ResendThrottleService,
  type SendBudget,
} from '../../common/throttle/resend-throttle.service';
import { SignupRepository } from '../auth-signup/auth-signup.repository';
import {
  attendeeAccountsUnavailable,
  signInInstead,
} from './auth-booking-signup.errors';
import type { OrderStatus } from './auth-booking-signup.types';
import { BookingClaimLinkService } from './booking-claim-link.service';
import type { BookingAccountDto } from './dto/booking-account.dto';
import type { BookingLinkSentDto } from './dto/booking-link-sent.dto';
import {
  BookingClaimOrderPort,
  type ClaimableBooking,
} from './ports/booking-claim-order.port';

const ORDER_NOT_FOUND = 'That order could not be found.';

/** The one status whose booking has tickets to keep in an account. */
const CONFIRMED: OrderStatus = 'confirmed';
const BOOKING_NOT_CONFIRMED =
  "This booking isn't confirmed, so there are no tickets to keep in an account yet.";

const SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * How many claim emails one address may be sent a day, on top of the
 * one-a-minute cool-off. Whoever holds an order id can ask — the booker, not
 * only the buyer, and anybody can book with anybody's address — so the
 * cool-off alone would let a stranger have Eventa mail somebody ~1,440 times a
 * day. A handful covers a buyer whose first link went to spam.
 */
const CLAIM_LINK_BUDGET: SendBudget = {
  max: 5,
  windowSeconds: SECONDS_PER_DAY,
};

/**
 * The cool-off key for a booking's claim email: per address, in a space no
 * sign-up or phone identity can spell (those are `persona|email` and a user
 * id), so asking for this link never spends anybody's confirmation-email
 * cool-off, and theirs never spends this one.
 */
function claimThrottleIdentity(email: string): string {
  return `booking-claim:${email.toLowerCase()}`;
}

/**
 * Offering the buyer an account from their booking (US-DISC-15): whether the
 * address already has one, and sending the link that lets them create it.
 *
 * THE TRUST RULE. The order id is shown in the BOOKER's browser before anybody
 * has read the buyer's inbox — and anybody can book with anybody's address. So
 * holding the order id proves nothing about the address, and an account made
 * from it alone would let a stranger choose the password of an account that
 * sees every ticket ever bought with that address. Nothing is created here, and
 * no password is chosen: this only sends a one-time link to the booking's
 * address, and `BookingClaimService` acts on that link alone.
 */
@Injectable()
export class AuthBookingSignupService {
  constructor(
    private readonly bookings: BookingClaimOrderPort,
    private readonly accounts: SignupRepository,
    private readonly links: BookingClaimLinkService,
    private readonly throttle: ResendThrottleService,
  ) {}

  /**
   * Which offer the confirmation page makes: create an account, or sign in.
   * Says no more than the order page already shows its holder — the address
   * is on it — plus whether that address has an account to sign in to.
   *
   * Only for a confirmed booking, refused (409) like the link for any other.
   * Anybody can place an unpaid order with anybody's address and is handed
   * its uuid, and an owed order emails nobody — answering for it would tell a
   * stranger, silently and as often as they asked, whether the address has an
   * account. A confirmed booking has at least mailed its tickets to the
   * address, and only it is made the offer.
   */
  async accountFor(orderId: string): Promise<BookingAccountDto> {
    const booking = await this.bookingOrNotFound(orderId);
    assertConfirmed(booking);
    return { accountExists: await this.hasAccount(booking.buyerEmail) };
  }

  /**
   * Email the booking's address the link that creates its account.
   *
   * Every refusal that sends nothing — no such order, a booking that isn't
   * confirmed, an account already, a missing platform organization — comes
   * before the cool-off is spent: there is nothing to ration, and a later,
   * good request (a confirmed booking for the same address) must not be told
   * to wait for a link that never went out.
   */
  async requestLink(orderId: string): Promise<BookingLinkSentDto> {
    const booking = await this.bookingOrNotFound(orderId);
    assertConfirmed(booking);
    if (await this.hasAccount(booking.buyerEmail)) throw signInInstead();
    const platformOrganizationId = await this.platformOrganizationId();
    await this.throttle.claim(
      claimThrottleIdentity(booking.buyerEmail),
      'link',
      CLAIM_LINK_BUDGET,
    );
    await this.links.send(booking, platformOrganizationId);
    return { sentTo: booking.buyerEmail };
  }

  /**
   * Whether the address has an account to sign in to. One nobody confirmed
   * does not count: anybody can sign up with anybody's address and choose its
   * password, and telling the address's owner to sign in to that account —
   * or refusing them a link because of it — would steer them into the
   * stranger's password (pre-account takeover). The claim link supersedes it.
   */
  private async hasAccount(email: string): Promise<boolean> {
    const account = await this.accounts.findPlatformAttendee(email);
    return account?.confirmed ?? false;
  }

  private async bookingOrNotFound(orderId: string): Promise<ClaimableBooking> {
    const booking = await this.bookings.findBooking(orderId);
    if (!booking) throw DomainException.notFound(ORDER_NOT_FOUND);
    return booking;
  }

  /** Every attendee account — and so every claim email — belongs here. */
  private async platformOrganizationId(): Promise<number> {
    const id = await this.accounts.findPlatformOrganizationId();
    if (id === null) throw attendeeAccountsUnavailable();
    return id;
  }
}

/**
 * Only a confirmed booking has tickets to keep, so only it is told whether its
 * address has an account and sent a link; every other status is refused (409).
 */
function assertConfirmed(booking: ClaimableBooking): void {
  if (booking.status !== CONFIRMED) {
    throw DomainException.conflict(BOOKING_NOT_CONFIRMED);
  }
}
