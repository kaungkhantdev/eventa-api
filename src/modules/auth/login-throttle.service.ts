import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { DomainException } from '../../common/errors/domain.exception';
import { REDIS } from '../../common/redis/redis.constants';
import type { Env } from '../../config/env.validation';

const LOCKED_MESSAGE =
  'Too many sign-in attempts. Please try again later or reset your password.';

/**
 * Brute-force protection for sign-in (US-ACC-12). Counts consecutive failures per
 * attempted identity (org + audience + email) in Redis and locks the identity for a
 * cool-off once the limit is hit — applied to non-existent accounts too, so the
 * response never reveals whether an account exists. Fail-open: if Redis is
 * unavailable, sign-in still works (availability over lockout).
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

  /** Refuse (429) while the identity is in a cool-off lock. */
  async assertNotLocked(identity: string): Promise<void> {
    let locked = 0;
    try {
      locked = await this.redis.exists(this.lockKey(identity));
    } catch (err) {
      this.logger.warn(
        { err },
        'login throttle unavailable — allowing sign-in',
      );
      return;
    }
    if (locked) throw DomainException.tooManyRequests(LOCKED_MESSAGE);
  }

  /** Count a failed attempt; lock the identity once the limit is reached. */
  async recordFailure(identity: string): Promise<void> {
    try {
      const fails = await this.redis.incr(this.failKey(identity));
      if (fails === 1) {
        await this.redis.expire(this.failKey(identity), this.lockSeconds);
      }
      if (fails >= this.maxAttempts) {
        await this.redis.set(
          this.lockKey(identity),
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
      await this.redis.del(this.failKey(identity), this.lockKey(identity));
    } catch (err) {
      this.logger.warn({ err }, 'login throttle could not clear counters');
    }
  }

  private failKey(identity: string): string {
    return `login:fail:${identity}`;
  }

  private lockKey(identity: string): string {
    return `login:lock:${identity}`;
  }
}
