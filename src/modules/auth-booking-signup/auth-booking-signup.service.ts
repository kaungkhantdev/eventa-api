import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException } from '../../common/errors/domain.exception';
import {
  ResendThrottleService,
  type SendBudget,
} from '../../common/throttle/resend-throttle.service';
import { Clock } from '../../common/time/clock';
import type { Env } from '../../config/env.validation';
import { SignupRepository } from '../auth-signup/auth-signup.repository';
import { TokenService } from '../auth/token.service';
import { OutboxPort } from '../platform/outbox.port';
import {
  attendeeAccountsUnavailable,
  signInInstead,
} from './auth-booking-signup.errors';
import type { BookingAccountDto } from './dto/booking-account.dto';
import type { BookingLinkSentDto } from './dto/booking-link-sent.dto';
import { bookingAccountLinkRequestedEvent } from './events/booking-account-link-requested.event';
import {
  BookingClaimOrderPort,
  type ClaimableBooking,
} from './ports/booking-claim-order.port';

const ORDER_NOT_FOUND = 'That order could not be found.';

/**
 * The page on the web app the emailed link opens. It shows the booking's name
 * and address and asks only for a password.
 */
const CLAIM_PAGE = '/portal/register';

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
  private readonly publicWebUrl: string;

  constructor(
    private readonly bookings: BookingClaimOrderPort,
    private readonly accounts: SignupRepository,
    private readonly tokens: TokenService,
    private readonly outbox: OutboxPort,
    private readonly throttle: ResendThrottleService,
    private readonly clock: Clock,
    config: ConfigService<Env, true>,
  ) {
    this.publicWebUrl = config.getOrThrow('PUBLIC_WEB_URL', { infer: true });
  }

  /**
   * Which offer the confirmation page makes: create an account, or sign in.
   * Says no more than the order page already shows its holder — the address
   * is on it — plus whether that address has an account to sign in to.
   */
  async accountFor(orderId: string): Promise<BookingAccountDto> {
    const booking = await this.bookingOrNotFound(orderId);
    return { accountExists: await this.hasAccount(booking.buyerEmail) };
  }

  /**
   * Email the booking's address the link that creates its account.
   *
   * Every refusal that sends nothing — no such order, an account already,
   * a missing platform organization — comes before the cool-off is spent:
   * there is nothing to ration, and a later, good request must not be told
   * to wait for a link that never went out.
   */
  async requestLink(orderId: string): Promise<BookingLinkSentDto> {
    const booking = await this.bookingOrNotFound(orderId);
    if (await this.hasAccount(booking.buyerEmail)) throw signInInstead();
    const platformOrganizationId = await this.platformOrganizationId();
    await this.throttle.claim(
      claimThrottleIdentity(booking.buyerEmail),
      'link',
      CLAIM_LINK_BUDGET,
    );
    await this.sendLink(booking, platformOrganizationId);
    return { sentTo: booking.buyerEmail };
  }

  private async sendLink(
    booking: ClaimableBooking,
    platformOrganizationId: number,
  ): Promise<void> {
    const { token, expiresAt } = await this.tokens.signBookingClaim({
      orderId: booking.orderId,
      email: booking.buyerEmail,
    });
    await this.outbox.enqueue(
      bookingAccountLinkRequestedEvent({
        organizationId: platformOrganizationId,
        orderId: booking.orderId,
        name: booking.buyerName,
        email: booking.buyerEmail,
        eventName: booking.eventName,
        claimUrl: `${this.publicWebUrl}${CLAIM_PAGE}?claim=${token}`,
        expiresAt: expiresAt.toISOString(),
        locale: booking.locale,
        occurredAt: this.clock.now().toISOString(),
      }),
    );
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
