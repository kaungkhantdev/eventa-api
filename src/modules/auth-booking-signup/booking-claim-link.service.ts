import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Clock } from '../../common/time/clock';
import type { Env } from '../../config/env.validation';
import { TokenService } from '../auth/token.service';
import { OutboxPort } from '../platform/outbox.port';
import { invalidClaimLink } from './auth-booking-signup.errors';
import { bookingAccountLinkRequestedEvent } from './events/booking-account-link-requested.event';
import type { ClaimableBooking } from './ports/booking-claim-order.port';

/**
 * The page on the web app the emailed link opens. It shows the booking's name
 * and address and asks only for a password.
 */
const CLAIM_PAGE = '/portal/register';

/** A claim link that verified: which booking it names, and which inbox it proves. */
export interface ClaimLink {
  orderId: string;
  /** The address the link was sent to — and so the only one it proves. */
  email: string;
}

/**
 * The one-time link a booking's address is emailed (US-DISC-15) — the only
 * proof that whoever creates the account reads that inbox.
 *
 * Sent: signed for the order and the address, put in the email's `claimUrl`,
 * and handed to eventa-worker through the outbox — to that address and
 * nowhere else. Read: verified as a booking claim and nothing else, or
 * refused in the one sentence every dead link gets.
 *
 * The token rides in the event's payload as a password reset's does in
 * `resetUrl`, and is never logged — neither is the address.
 */
@Injectable()
export class BookingClaimLinkService {
  private readonly publicWebUrl: string;

  constructor(
    private readonly tokens: TokenService,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
    config: ConfigService<Env, true>,
  ) {
    this.publicWebUrl = config.getOrThrow('PUBLIC_WEB_URL', { infer: true });
  }

  /** Email the booking's address its link. Every claim email is the platform's. */
  async send(
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
   * What an opened link names, or the 400 every dead link gets: malformed,
   * forged, expired, or any other token this API signs.
   */
  async read(token: string): Promise<ClaimLink> {
    try {
      const claims = await this.tokens.verifyBookingClaim(token);
      return { orderId: claims.sub, email: claims.email };
    } catch {
      throw invalidClaimLink();
    }
  }
}
