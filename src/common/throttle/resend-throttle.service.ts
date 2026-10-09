import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { DomainException } from '../errors/domain.exception';
import { REDIS } from '../redis/redis.constants';
import type { Env } from '../../config/env.validation';

/**
 * What was sent, so the refusal names the thing the member is waiting for.
 * A map rather than one sentence with a noun spliced in, so each reads like
 * something a person wrote — the same shape `lockedMessage` uses for sign-in.
 */
export type ResendKind = 'link' | 'code';

/**
 * Whether an unreachable throttle refuses rather than allows.
 *
 * `code` refuses: what gets spent is somebody's money and the guess budget
 * against their account, and neither is recoverable by waiting. `link` allows,
 * because the harm of refusing — a person unable to get their own confirmation
 * email while Redis is down — is worse than an extra send.
 */
const FAIL_CLOSED: Record<ResendKind, boolean> = { link: false, code: true };

const WAIT_MESSAGE: Record<ResendKind, string> = {
  link: 'A confirmation link was just sent. Give it a minute before asking for another.',
  code: 'A code was just sent. Give it a minute before asking for another.',
};

/**
 * One confirmation per identity per cool-off.
 *
 * Shared by sign-up's confirmation email (US-ACC-01) and the phone
 * confirmation code (US-DISC-11 AC3) — which is why it lives in `common/`
 * rather than inside `auth-signup`, where it was born. Both are the same
 * problem: an endpoint that makes Eventa deliver a message on demand.
 *
 * The page counts down too, but a countdown in a browser is a courtesy rather
 * than a limit — a reload steps straight past it, and `curl` never sees it at
 * all. Without this, a signed-in caller can make Eventa text a number once a
 * second, which is somebody else's phone ringing and Eventa's bill.
 *
 * The IDENTITY is the caller's to choose, and what it names decides what the
 * cool-off protects. Sign-up keys on the address as typed, whether or not an
 * account exists, so the throttle cannot answer the question the response
 * deliberately refuses to. The phone flow keys on the ACCOUNT rather than the
 * number, because the thing being rationed is paid sends on that account's
 * behalf — keying on the number would let one session text a fresh number
 * every second and pay for all of them.
 *
 * **Whether it fails open is the CALLER's choice, because the two kinds are not
 * alike.** A resent sign-up link that escapes the cool-off during a Redis
 * outage costs an extra email, and refusing it would lock real people out of
 * their own accounts — so `link` still fails open, as the sign-in throttle
 * does.
 *
 * A `code` is different in two ways that only became clear once one existed.
 * Each one is a paid SMS to a number the requester chose, and issuing one
 * RESETS `users.phone_code_attempts` — so failing open does not merely lose a
 * rate limit, it hands out unlimited fresh guess budgets against a six-digit
 * secret, and bills for every one. This docstring used to claim the guess limit
 * could not fail open because it lives in Postgres; that is true within a
 * single code's life and was never true of the number of codes.
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

  /** Refuse (429) while one sent moments ago is still in flight. */
  async assertAllowed(
    identity: string,
    kind: ResendKind = 'link',
  ): Promise<void> {
    let recent = 0;
    try {
      recent = await this.redis.exists(this.key(identity));
    } catch (err) {
      // Ids only; an identity is PII and the error may carry more.
      this.logger.warn(
        { kind },
        err instanceof Error
          ? `resend throttle unavailable (${err.name})`
          : 'resend throttle unavailable',
      );
      if (FAIL_CLOSED[kind])
        throw DomainException.tooManyRequests(WAIT_MESSAGE[kind]);
      return;
    }
    if (recent) throw DomainException.tooManyRequests(WAIT_MESSAGE[kind]);
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
