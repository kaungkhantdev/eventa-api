import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { DomainException } from '../../common/errors/domain.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { ResendThrottleService } from '../../common/throttle/resend-throttle.service';
import { Clock } from '../../common/time/clock';
import { toThaiMobileE164 } from '../../common/util/thai-mobile';
import type { Env } from '../../config/env.validation';
import type { AuthContext } from '../auth/auth.types';
import { ProfileResponseDto } from './dto/profile-response.dto';
import { phoneVerificationRequestedEvent } from './events/phone-verification-requested.event';
import { toProfileResponse } from './profile.mapper';
import { ProfileRepository } from './profile.repository';
import type { PhoneChallengeRow, ProfileRow } from './users.types';

/** Six digits: what a person will retype off a lock screen without a mistake. */
const CODE_DIGITS = 6;
const CODE_CEILING = 10 ** CODE_DIGITS;

const NOT_A_MOBILE_MESSAGE =
  'Enter a Thai mobile number — for example 0812345678. Eventa can only text Thai mobiles.';
const ALREADY_CONFIRMED_MESSAGE =
  'That is already the confirmed number on your account.';
const NOTHING_PENDING_MESSAGE =
  'There is no number waiting to be confirmed. Ask for a code first.';
const WRONG_CODE_MESSAGE =
  "That code didn't match. Check the text and retype it.";
const CODE_GONE_MESSAGE =
  'That code is no longer valid. Ask for a new one and we will text it again.';
const TOO_MANY_MESSAGE =
  'Too many wrong codes. Ask for a new one and we will text it again.';

/**
 * Confirming a changed phone number by a texted code (US-DISC-11 AC3).
 *
 * This is the email change one field over, and deliberately the same shape:
 * the requested value is HELD (`pending_phone`) while the value in use keeps
 * working, and one guarded write is the only thing that can promote it. A
 * short code replaces the link because a phone receives texts, not clicks, and
 * that one difference is what the rest of this class is about — a link carries
 * its own signature and a six-digit code does not, so the code needs a TTL, an
 * attempt cap and a hash where the link needed none of them.
 *
 * It is a class inside `users/` rather than a module of its own because it
 * writes the same row the profile does, and a sibling module would have to
 * reach into this module's repository to do it — which AGENTS.md forbids, and
 * rightly: there is one `users` row and one thing that may write its contact
 * details.
 *
 * WHAT CHANGING A NUMBER CLEARS. Confirming one clears the whole challenge
 * (pending number, hash, expiry, count) and stamps `phone_verified_at`. Asking
 * again — for a different number, or the same one because the text never
 * arrived — replaces the challenge wholesale, so the earlier code is dead the
 * moment the new one is written and the member gets a fresh five attempts;
 * there is never more than one code alive per account.
 *
 * That reset is why HOW MANY TIMES they may ask is a security limit and not
 * just a courtesy, and why `request` claims a send from `ResendThrottleService`
 * before it writes anything. The attempt cap bounds the guesses against one
 * code; the throttle bounds the number of codes, and therefore the number of
 * times that cap is handed back. Neither one is a bound on its own.
 *
 * Notification preferences are deliberately NOT rewritten: whether SMS is
 * available is DERIVED from the confirmed number every time it is asked, so
 * there is no second copy of that fact to go stale (see
 * NotificationPreferencesService).
 */
@Injectable()
export class PhoneVerificationService {
  private readonly codeTtlSeconds: number;
  private readonly maxAttempts: number;

  constructor(
    private readonly repo: ProfileRepository,
    private readonly throttle: ResendThrottleService,
    private readonly clock: Clock,
    config: ConfigService<Env, true>,
  ) {
    this.codeTtlSeconds = config.get('PHONE_VERIFY_CODE_TTL_SECONDS', {
      infer: true,
    });
    // The codebase's established number for tries at a credential (US-ACC-12),
    // reused rather than duplicated under a new name. Where it is COUNTED
    // differs: sign-in counts in Redis and fails open, this counts in the row.
    this.maxAttempts = config.get('LOGIN_MAX_ATTEMPTS', { infer: true });
  }

  /**
   * Ask to use a new number: hold it, text a code to it, change nothing else.
   *
   * Asking again with the same number is the resend — one endpoint, because
   * "send it again" and "I mistyped it, here is another" are the same request
   * from the member's side and the same work from ours.
   *
   * Which is also why both are rationed together, by one claim on the account:
   * from here they are indistinguishable, and each one costs a paid text and
   * hands back a fresh guess budget against the account.
   */
  async request(auth: AuthContext, phone: string): Promise<ProfileResponseDto> {
    const pendingPhone = this.requireTextable(phone);
    const current = await this.load(auth);
    this.assertNotAlreadyConfirmed(current, pendingPhone);

    // After both refusals — a number we would never text, and a number that is
    // already confirmed should spend neither the cool-off nor a send from the
    // budget — and BEFORE the write, because the claim has to cover the send
    // whether or not the send then works.
    await this.throttle.claim(cooldownIdentity(auth), 'code');

    const code = generateCode();
    const expiresAt = new Date(
      this.clock.now().getTime() + this.codeTtlSeconds * 1000,
    );
    const saved = await this.repo.startPhoneChange(
      auth.organizationId,
      auth.userId,
      { pendingPhone, codeHash: hashCode(code), expiresAt },
      phoneVerificationRequestedEvent({
        organizationId: auth.organizationId,
        userId: auth.userId,
        name: current.name,
        phone: pendingPhone,
        code,
        expiresAt: expiresAt.toISOString(),
        occurredAt: this.clock.now().toISOString(),
      }),
    );
    if (!saved) throw DomainException.notFound('Profile not found.');
    return toProfileResponse(saved);
  }

  /**
   * Type the code back: the held number becomes the one Eventa texts.
   *
   * The guess is CLAIMED before it is compared, in one statement, so the
   * attempt budget actually binds. Reading the challenge and incrementing
   * afterwards let concurrent requests all compare against the same unspent
   * budget — the cap never fired, and the real limit was how many requests the
   * pool would carry at once.
   */
  async confirm(auth: AuthContext, code: string): Promise<ProfileResponseDto> {
    const challenge = await this.repo.claimPhoneCodeAttempt(
      auth.organizationId,
      auth.userId,
      this.maxAttempts,
    );
    // No code in flight, or the budget is spent. Deliberately the same answer
    // for both: telling them which distinguishes "keep guessing" from "ask for
    // a new one", and that is a distinction an attacker benefits from.
    if (!challenge) throw this.codeGone(TOO_MANY_MESSAGE);
    this.assertLive(challenge);
    if (!matches(challenge.phoneCodeHash, code)) {
      throw DomainException.invalidField('code', WRONG_CODE_MESSAGE);
    }
    // A live code with no number held behind it cannot be completed. It should
    // not happen — they are written and cleared together — so it is refused
    // rather than papered over with a guess at what was meant.
    if (!challenge.pendingPhone) throw this.codeGone(CODE_GONE_MESSAGE);
    const saved = await this.repo.promotePhone(
      auth.organizationId,
      auth.userId,
      challenge.pendingPhone,
    );
    // The pending number moved between the check and the write — somebody
    // asked for a different one in another tab. The code that just matched
    // proved a number that is no longer the one on offer.
    if (!saved) throw this.codeGone(CODE_GONE_MESSAGE);
    return toProfileResponse(saved);
  }

  /**
   * Remove the number and anything in flight.
   *
   * It needs a route of its own because `phone` left `PATCH /me/profile`, and
   * without one a member who typed a number could never take it back —
   * "organizers can reach me" (US-DISC-11) has to include deciding they
   * cannot. No code: proving a number to delete it makes no sense, and nothing
   * is sent anywhere as a result.
   */
  async remove(auth: AuthContext): Promise<ProfileResponseDto> {
    const saved = await this.repo.clearPhone(auth.organizationId, auth.userId);
    if (!saved) throw DomainException.notFound('Profile not found.');
    return toProfileResponse(saved);
  }

  /** Count the miss, then refuse — differently once the cap has eaten the code. */
  private async refuseCode(auth: AuthContext): Promise<never> {
    const attempts = await this.repo.recordPhoneCodeFailure(
      auth.organizationId,
      auth.userId,
      this.maxAttempts,
    );
    if (attempts >= this.maxAttempts) throw this.codeGone(TOO_MANY_MESSAGE);
    throw DomainException.invalidField('code', WRONG_CODE_MESSAGE);
  }

  private assertNotAlreadyConfirmed(
    current: ProfileRow,
    pendingPhone: string,
  ): void {
    // Only a CONFIRMED match is refused. A number already sitting in `phone`
    // but never proven — every number that predates this story — must be
    // requestable, or those accounts could never confirm what they already
    // have and would have to retype it to a different value and back.
    if (current.phone === pendingPhone && current.phoneVerifiedAt !== null) {
      throw DomainException.invalidField('phone', ALREADY_CONFIRMED_MESSAGE);
    }
  }

  /**
   * Narrowed to the two fields it reads, so the atomic claim can be passed
   * straight in: that statement returns what it needs to compare and nothing
   * else, and widening it back to a whole row would invite a second read.
   */
  private assertLive(challenge: {
    phoneCodeHash: string | null;
    phoneCodeExpiresAt: Date | null;
  }): void {
    if (!challenge.phoneCodeHash || !challenge.phoneCodeExpiresAt) {
      throw this.codeGone(CODE_GONE_MESSAGE);
    }
    if (challenge.phoneCodeExpiresAt.getTime() <= this.clock.now().getTime()) {
      throw this.codeGone(CODE_GONE_MESSAGE);
    }
  }

  private requireTextable(phone: string): string {
    const normalized = toThaiMobileE164(phone);
    if (!normalized) {
      throw DomainException.invalidField('phone', NOT_A_MOBILE_MESSAGE);
    }
    return normalized;
  }

  private async requireChallenge(auth: AuthContext): Promise<LiveChallenge> {
    const challenge = await this.repo.findPhoneChallenge(
      auth.organizationId,
      auth.userId,
    );
    if (!challenge?.pendingPhone) {
      throw DomainException.validation(NOTHING_PENDING_MESSAGE);
    }
    return challenge as LiveChallenge;
  }

  private async load(auth: AuthContext): Promise<ProfileRow> {
    const row = await this.repo.find(auth.organizationId, auth.userId);
    if (!row) throw DomainException.notFound('Profile not found.');
    return row;
  }

  /**
   * Its own code, not `VALIDATION_ERROR`: there is nothing left to retype, and
   * the page shows "send a new code" rather than an error under the input.
   */
  private codeGone(message: string): DomainException {
    return new DomainException(
      ErrorCode.PHONE_CODE_EXPIRED,
      message,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** A challenge known to name a pending number. */
type LiveChallenge = PhoneChallengeRow & { pendingPhone: string };

/**
 * Keyed on the ACCOUNT, not the number: what is rationed is paid sends on this
 * member's behalf, and a key per number would let one session text a new
 * stranger every second. Includes the organization because a user id is only
 * unique within one, and this shares a Redis keyspace with every other tenant.
 */
function cooldownIdentity(auth: AuthContext): string {
  return `phone|${auth.organizationId}|${auth.userId}`;
}

/**
 * `randomInt` rather than `Math.random()` or a modulo of random bytes: this is
 * the entire secret, and both of the alternatives bias it — the first is not a
 * CSPRNG at all, the second makes low codes likelier. Padded, because 040291
 * is a perfectly good code and must not arrive as five digits.
 */
function generateCode(): string {
  return String(randomInt(0, CODE_CEILING)).padStart(CODE_DIGITS, '0');
}

/**
 * Codes are compared, never shown again, so only the hash is stored — the
 * choice `recovery_codes.code_hash` already makes (and the opposite of the
 * TOTP seed in `two_factors`, which must be readable to verify anything).
 *
 * Honest about what SHA-256 buys for six digits: nothing against anyone who
 * can run a million hashes offline. What it buys is that the row, a backup or
 * a replica is not a working credential — the TTL and the attempt cap are what
 * make the code a secret.
 */
function hashCode(code: string): string {
  return createHash('sha256').update(code.trim()).digest('hex');
}

/** Constant-time, so the comparison itself leaks nothing about the code. */
function matches(storedHash: string | null, code: string): boolean {
  if (!storedHash) return false;
  const expected = Buffer.from(storedHash, 'hex');
  const actual = Buffer.from(hashCode(code), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
