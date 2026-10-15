import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { REDIS } from '../../common/redis/redis.constants';
import { Clock } from '../../common/time/clock';
import type { Env } from '../../config/env.validation';
import type { BookingClaimClaims } from '../auth/auth.types';
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

/** Where a used link is remembered; the rest of the key is a digest of it. */
const SPENT_PREFIX = 'booking-claim:spent:';
const MS_PER_SECOND = 1000;

/** A claim link that verified: which booking it names, and which inbox it proves. */
export interface ClaimLink {
  orderId: string;
  /** The address the link was sent to — and so the only one it proves. */
  email: string;
  /** Whether this link has already made an account. */
  spent: boolean;
  /** The link's entry in the ledger of used links — a digest, never the token. */
  readonly ledgerKey: string;
  /** When the link dies anyway, so the ledger need not remember it longer. */
  readonly expiresAt: Date;
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
 * Spent: "the link works only once" is kept by a ledger, not only by the
 * account it made — otherwise, inside its seven days, the same link would make
 * the account again once its owner deleted it or moved it to another address,
 * for whoever holds the old email. The ledger (Redis) remembers a digest of
 * each link that made an account, until the link would have expired anyway.
 * It fails OPEN, as the link cool-off does: unreachable, a link is read as
 * unspent, and single use falls back to the account it made answering "sign
 * in instead" — an outage never refuses somebody their own account.
 *
 * The token rides in the event's payload as a password reset's does in
 * `resetUrl`, and is never logged — neither is the address, and the ledger
 * holds neither.
 */
@Injectable()
export class BookingClaimLinkService {
  private readonly logger = new Logger(BookingClaimLinkService.name);
  private readonly publicWebUrl: string;

  constructor(
    private readonly tokens: TokenService,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
    config: ConfigService<Env, true>,
    @Inject(REDIS) private readonly redis: Redis,
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
    const claims = await this.verify(token);
    const ledgerKey = SPENT_PREFIX + digest(token);
    return {
      orderId: claims.sub,
      email: claims.email,
      spent: await this.isSpent(ledgerKey),
      ledgerKey,
      expiresAt: new Date(claims.exp * MS_PER_SECOND),
    };
  }

  /** Record that this link has made an account. */
  async spend(link: ClaimLink): Promise<void> {
    const secondsLeft = Math.ceil(
      (link.expiresAt.getTime() - this.clock.now().getTime()) / MS_PER_SECOND,
    );
    try {
      await this.redis.set(link.ledgerKey, '1', 'EX', Math.max(1, secondsLeft));
    } catch (err) {
      this.ledgerUnavailable(err);
    }
  }

  private async verify(token: string): Promise<BookingClaimClaims> {
    try {
      return await this.tokens.verifyBookingClaim(token);
    } catch {
      throw invalidClaimLink();
    }
  }

  private async isSpent(ledgerKey: string): Promise<boolean> {
    try {
      return (await this.redis.exists(ledgerKey)) > 0;
    } catch (err) {
      this.ledgerUnavailable(err);
      return false;
    }
  }

  /** Said without the key or the error's detail: either may carry the link. */
  private ledgerUnavailable(err: unknown): void {
    this.logger.warn(
      err instanceof Error
        ? `claim link ledger unavailable (${err.name})`
        : 'claim link ledger unavailable',
    );
  }
}

/** A link's identity in the ledger: one-way, so the ledger holds no credential. */
function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
