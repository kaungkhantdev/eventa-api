import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { DomainException } from '../../common/errors/domain.exception';
import { REDIS } from '../../common/redis/redis.constants';
import type { Env } from '../../config/env.validation';

const WAIT_MESSAGE =
  'A confirmation link was just sent. Give it a minute before asking for another.';

/**
 * One confirmation email per address per cool-off.
 *
 * The sign-up page counts down too, but a countdown in a browser is a courtesy
 * rather than a limit — a reload steps straight past it, and `curl` never sees
 * it at all. Without this, a public endpoint that sends mail on demand is a way
 * to have Eventa deliver somebody else's inbox a message a second.
 *
 * Keyed on the address as typed, whether or not an account exists, so the
 * throttle cannot answer the question the response deliberately refuses to.
 *
 * Fail-open, like the sign-in throttle: if Redis is down, a resend still works.
 * Losing the rate limit for a few minutes is a smaller harm than locking real
 * people out of their own accounts.
 */
@Injectable()
export class ResendThrottleService {
  private readonly logger = new Logger(ResendThrottleService.name);
  private readonly cooldownSeconds: number;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    config: ConfigService<Env, true>,
  ) {
    this.cooldownSeconds = config.get('VERIFY_RESEND_COOLDOWN_SECONDS', {
      infer: true,
    });
  }

  /** Refuse (429) while a link sent moments ago is still in flight. */
  async assertAllowed(identity: string): Promise<void> {
    let recent = 0;
    try {
      recent = await this.redis.exists(this.key(identity));
    } catch (err) {
      this.logger.warn({ err }, 'resend throttle unavailable — allowing');
      return;
    }
    if (recent) throw DomainException.tooManyRequests(WAIT_MESSAGE);
  }

  /** Start the cool-off. Called whether or not anything was actually sent. */
  async remember(identity: string): Promise<void> {
    try {
      await this.redis.set(this.key(identity), '1', 'EX', this.cooldownSeconds);
    } catch (err) {
      this.logger.warn({ err }, 'resend throttle unavailable — not recorded');
    }
  }

  private key(identity: string): string {
    return `verify:resend:${identity}`;
  }
}
