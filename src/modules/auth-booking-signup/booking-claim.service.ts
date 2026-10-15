import { Injectable } from '@nestjs/common';
import {
  UQ_USERS_ORG_EMAIL_PERSONA,
  isUniqueViolation,
} from '../../common/errors/unique-violation';
import { PasswordService } from '../auth-password/auth-password.service';
import { SignupRepository } from '../auth-signup/auth-signup.repository';
import { AuthService, type LoginResult } from '../auth/auth.service';
import { TokenService } from '../auth/token.service';
import { UsersRepository } from '../users/users.repository';
import {
  attendeeAccountsUnavailable,
  invalidClaimLink,
  signInInstead,
} from './auth-booking-signup.errors';
import type { BookingClaimPreviewDto } from './dto/booking-claim-preview.dto';
import { BookingClaimOrderPort } from './ports/booking-claim-order.port';

export interface ClaimInput {
  token: string;
  password: string;
  device: string;
  ip: string | null;
}

/** The person a good link creates an account for. */
interface Claimant {
  /** From the order — the buyer's name as they booked. */
  name: string;
  /** From the link — the address it was sent to, and so the one proven. */
  email: string;
}

/**
 * Creating an attendee account from the link a booking's address was emailed
 * (US-DISC-15) — the one sign-up that needs no confirmation email and signs
 * straight in, because opening the link IS the confirmation.
 *
 * The address comes from the verified link and nowhere else; the name from the
 * order. The caller supplies a password and nothing more, so an account can
 * only ever be made for the inbox that received the link — and the person who
 * chooses its password is, by construction, the person who reads that inbox.
 *
 * Single use without a ledger: a claim creates the address's account, and a
 * second claim finds it and is told to sign in.
 */
@Injectable()
export class BookingClaimService {
  constructor(
    private readonly bookings: BookingClaimOrderPort,
    private readonly tokens: TokenService,
    private readonly accounts: SignupRepository,
    private readonly passwords: PasswordService,
    private readonly users: UsersRepository,
    private readonly auth: AuthService,
  ) {}

  /**
   * What the page shows before asking for a password, without spending the
   * link: whose account it creates, and whether one already exists.
   */
  async inspect(token: string): Promise<BookingClaimPreviewDto> {
    const claimant = await this.claimantOfGoodLink(token);
    return {
      ...claimant,
      accountExists: await this.accounts.platformAttendeeExists(claimant.email),
    };
  }

  /** Create the account, Active, and open its first session. */
  async claim(input: ClaimInput): Promise<LoginResult> {
    const claimant = await this.claimantOfGoodLink(input.token);
    if (await this.accounts.platformAttendeeExists(claimant.email)) {
      throw signInInstead();
    }
    const userId = await this.createAccount(claimant, input.password);
    const found = await this.users.findProfile(userId);
    if (!found) throw attendeeAccountsUnavailable();
    return this.auth.startSession(found, {
      device: input.device,
      ip: input.ip,
    });
  }

  /**
   * The one answer to "is this link still good", shared by `inspect` and
   * `claim` so the page can never call a link good that the claim refuses.
   *
   * Good means signed by us, unexpired, a booking claim and nothing else, for
   * an order that still exists and still carries the address the link was
   * sent to. If the order's address has changed since, the link proves an
   * inbox the booking no longer names, so it is dead.
   */
  private async claimantOfGoodLink(token: string): Promise<Claimant> {
    const claims = await this.decode(token);
    const booking = await this.bookings.findBooking(claims.sub);
    if (!booking || !sameAddress(booking.buyerEmail, claims.email)) {
      throw invalidClaimLink();
    }
    return { name: booking.buyerName, email: claims.email };
  }

  private async decode(token: string): Promise<{ sub: string; email: string }> {
    try {
      return await this.tokens.verifyBookingClaim(token);
    } catch {
      throw invalidClaimLink();
    }
  }

  /**
   * The check before this is what refuses a second claim; the index is what
   * refuses the loser of two at once, and gets the same answer.
   */
  private async createAccount(
    claimant: Claimant,
    password: string,
  ): Promise<string> {
    const passwordHash = await this.passwords.hash(password);
    const created = await this.accounts
      .createAttendeeAccount({ ...claimant, passwordHash, confirmed: true })
      .catch((cause: unknown) => {
        if (isUniqueViolation(cause, UQ_USERS_ORG_EMAIL_PERSONA)) {
          throw signInInstead();
        }
        throw cause;
      });
    if (!created) throw attendeeAccountsUnavailable();
    return created.userId;
  }
}

/** Addresses compare as the database compares them: case-insensitively. */
function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
