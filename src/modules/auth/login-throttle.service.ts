import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { DomainException } from '../../common/errors/domain.exception';
import { REDIS } from '../../common/redis/redis.constants';
import type { Env } from '../../config/env.validation';
import { lockedMessage, type LockedAttempt } from './lock-message';

/**
 * Where each kind of attempt keeps its count.
 *
 * The forgotten-password form shares sign-in's limit and cool-off but never its
 * keys (US-ACC-04). Identities are plain strings, and sign-in builds its own
 * from a workspace slug the caller types, so any identity shape the reset form
 * picked could be spelled by some slug — a workspace named "forgot" once made
 * failed sign-ins lock the reset form. A prefix the service owns cannot be
 * spelled from outside. Sign-in keeps `login`, so live locks survive a deploy.
 */
const KEY_PREFIX: Record<LockedAttempt, string> = {
  'sign-in': 'login',
  reset: 'reset',
};

/**
 * Brute-force protection for sign-in (US-ACC-12). Counts consecutive failures per
 * attempted identity (org + audience + email) in Redis and locks the identity for a
 * cool-off once the limit is hit — applied to non-existent accounts too, so the
 * response never reveals whether an account exists. Fail-open: if Redis is
 * unavailable, sign-in still works (availability over lockout).
 *
 * The forgotten-password form (US-ACC-04) counts its misses here too, on the
 * same limit but in its own keys (see `KEY_PREFIX`).
 */
@Injectable()
export class LoginThrottleService {
  private readonly logger = new Logger(LoginThrottleService.name);
  private readonly maxAttempts: number;
  private readonly lockSeconds: number;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    config: ConfigService<Env, true>,
  ) {
    this.maxAttempts = config.get('LOGIN_MAX_ATTEMPTS', { infer: true });
    this.lockSeconds = config.get('LOGIN_LOCK_SECONDS', { infer: true });
  }

  /**
   * Refuse (429) while the identity is in a cool-off lock, saying how long is
   * left.
   *
   * `ttl` answers "is it locked" and "for how long" in one round trip, so the
   * message costs nothing over the old existence check. A negative reply means
   * the key went away between asking and reading — the lock has expired, so the
   * attempt is allowed rather than refused with a time of -2.
   */
  async assertNotLocked(
    identity: string,
    /** What was attempted, so the refusal names the form they are on. */
    attempt: LockedAttempt = 'sign-in',
  ): Promise<void> {
    let secondsLeft = -2;
    try {
      secondsLeft = await this.redis.ttl(this.lockKey(identity, attempt));
    } catch (err) {
      this.logger.warn(
        { err },
        'login throttle unavailable — allowing sign-in',
      );
      return;
    }
    // -2 is no such key, -1 is a key with no expiry. Only the second is a lock.
    if (secondsLeft === -2) return;
    throw DomainException.tooManyRequests(lockedMessage(secondsLeft, attempt));
  }

  /** Count a failed attempt; lock the identity once the limit is reached. */
  async recordFailure(
    identity: string,
    attempt: LockedAttempt = 'sign-in',
  ): Promise<void> {
    const failKey = this.failKey(identity, attempt);
    try {
      const fails = await this.redis.incr(failKey);
      if (fails === 1) {
        await this.redis.expire(failKey, this.lockSeconds);
      }
      if (fails >= this.maxAttempts) {
        await this.redis.set(
          this.lockKey(identity, attempt),
          '1',
          'EX',
          this.lockSeconds,
        );
      }
    } catch (err) {
      this.logger.warn({ err }, 'login throttle could not record a failure');
    }
  }

  /** Clear the counter + lock after a successful sign-in. */
  async recordSuccess(identity: string): Promise<void> {
    try {
      await this.redis.del(
        this.failKey(identity, 'sign-in'),
        this.lockKey(identity, 'sign-in'),
      );
    } catch (err) {
      this.logger.warn({ err }, 'login throttle could not clear counters');
    }
  }

  private failKey(identity: string, attempt: LockedAttempt): string {
    return `${KEY_PREFIX[attempt]}:fail:${identity}`;
  }

  private lockKey(identity: string, attempt: LockedAttempt): string {
    return `${KEY_PREFIX[attempt]}:lock:${identity}`;
  }
}
