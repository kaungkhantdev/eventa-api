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

/**
 * Whether a kind spends from a per-window budget as well as the cool-off.
 *
 * Only `code` does. The cool-off bounds the RATE; a budget bounds the TOTAL,
 * and the two are different quantities — one code a minute for ever is ~1,440
 * codes a day. For a `link` the total is not worth bounding: an email costs
 * nothing, resets no guess budget, and refusing somebody their own confirmation
 * email for the rest of the day is a worse failure than another email.
 */
const BUDGETED: Record<ResendKind, boolean> = { link: false, code: true };

const WAIT_MESSAGE: Record<ResendKind, string> = {
  link: 'A confirmation link was just sent. Give it a minute before asking for another.',
  code: 'A code was just sent. Give it a minute before asking for another.',
};

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

/**
 * What a member out of budget is told: the wait, and the thing to check.
 *
 * Both halves earn their place. Without the wait, "too many" reads as a dead
 * end and somebody who has simply not received a text keeps hammering the form
 * — the behaviour the budget exists to stop. Without the second sentence the
 * only advice on offer is to come back and ask for a seventh code, which will
 * not arrive either if the first six did not.
 *
 * Rounded UP, as `lockedMessage` is: refusing somebody at the moment they were
 * told to return is worse than letting them in slightly early.
 */
function budgetMessage(secondsLeft: number): string {
  const wait =
    secondsLeft > 0 && Number.isFinite(secondsLeft)
      ? `You can ask for another in ${humanWait(secondsLeft)}.`
      : 'Please try again later.';
  return `That is as many codes as we can text one account for now. ${wait} If the texts are not arriving, another code will not help — check that the number is right and can receive SMS.`;
}

/** Minutes while it reads as minutes, hours once it does not. */
function humanWait(secondsLeft: number): string {
  const minutes = Math.ceil(secondsLeft / SECONDS_PER_MINUTE);
  if (minutes < MINUTES_PER_HOUR) return plural(minutes, 'minute');
  return plural(Math.ceil(minutes / MINUTES_PER_HOUR), 'hour');
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

/**
 * How many confirmations one identity may be sent, and how often.
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
 * TWO BOUNDS, because a cool-off is only one of them. The cool-off is the RATE:
 * one send per `VERIFY_RESEND_COOLDOWN_SECONDS`. On its own that is no bound at
 * all on the TOTAL — a minute apart, for ever, is ~1,440 codes and (since each
 * issuance resets `phone_code_attempts`) ~7,200 guesses a day against a
 * six-digit secret, plus 1,440 paid texts to numbers the requester chose.
 * `VERIFY_CODE_MAX_PER_WINDOW` per `VERIFY_CODE_WINDOW_SECONDS` is the total,
 * and it is the same answer `LoginThrottleService` gives to "too many tries at
 * a credential": count in Redis, and refuse for a cool-off once the count is
 * spent. It differs from sign-in in two ways, both deliberate — it counts
 * SENDS rather than failures, because a send costs money whether or not it
 * succeeds; and nothing clears it, because a text cannot be un-sent and an
 * attacker holding one number they can confirm would otherwise reset the
 * budget at will.
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
 * does. Sign-in is fail-open for the same reason and should stay that way: the
 * thing it rations is somebody's own password attempts, and an outage that
 * locked every account out of a workspace would be a worse incident than the
 * brute force it prevents.
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
  private readonly maxPerWindow: number;
  private readonly windowSeconds: number;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    config: ConfigService<Env, true>,
  ) {
    this.cooldownSeconds = config.get('VERIFY_RESEND_COOLDOWN_SECONDS', {
      infer: true,
    });
    this.maxPerWindow = config.get('VERIFY_CODE_MAX_PER_WINDOW', {
      infer: true,
    });
    this.windowSeconds = config.get('VERIFY_CODE_WINDOW_SECONDS', {
      infer: true,
    });
  }

  /**
   * Claim the right to send one now, or refuse (429).
   *
   * **Call this BEFORE sending, and only once.** It both asks and answers: the
   * cool-off is taken in the same round trip that tests it, so whatever the
   * caller does next, no second caller can be inside the same window.
   *
   * It replaces `assertAllowed` + `remember`, which could not be made to hold.
   * Those checked EXISTS, let the caller do its work, and set the key
   * afterwards — so every request that asked before the first one set was told
   * yes. One 60-second window issued as many codes as happened to arrive at
   * once, each a paid text and each one resetting the guess budget, which
   * multiplied the budget rather than bounding it. The same ordering also meant
   * a send that FAILED never reached `remember`, so the one outcome a caller
   * can arrange on purpose cost them no cool-off at all.
   *
   * The order inside is load-bearing: the cool-off is claimed first and the
   * budget is spent only by the caller that won it. Spending the budget first
   * would let somebody hammering the endpoint drain a member's whole daily
   * allowance with requests that were going to be refused anyway.
   */
  async claim(identity: string, kind: ResendKind = 'link'): Promise<void> {
    const won = await this.claimWindow(identity, kind);
    if (!won) throw DomainException.tooManyRequests(WAIT_MESSAGE[kind]);
    if (BUDGETED[kind]) await this.spendFromBudget(identity, kind);
  }

  /**
   * Refuse (429) while one sent moments ago is still in flight.
   *
   * @deprecated Prefer `claim`, which cannot be raced. This remains for
   * sign-up's confirmation email, which still checks and sets in two steps.
   * The window between its two calls is narrow — they are back to back, with no
   * work in between — and what escapes it is one extra email rather than a paid
   * text and a fresh guess budget, so migrating it is a tidy-up rather than a
   * fix.
   */
  async assertAllowed(
    identity: string,
    kind: ResendKind = 'link',
  ): Promise<void> {
    let recent = 0;
    try {
      recent = await this.redis.exists(this.cooldownKey(identity));
    } catch (err) {
      this.unavailable(err, kind);
      return;
    }
    if (recent) throw DomainException.tooManyRequests(WAIT_MESSAGE[kind]);
  }

  /** Start the cool-off. Called whether or not anything was actually sent. */
  async remember(identity: string): Promise<void> {
    try {
      await this.redis.set(
        this.cooldownKey(identity),
        '1',
        'EX',
        this.cooldownSeconds,
      );
    } catch (err) {
      this.logger.warn({ err }, 'resend throttle unavailable — not recorded');
    }
  }

  /**
   * Take the cool-off window, atomically. True if this caller took it.
   *
   * `SET … NX EX` is the whole point: Redis answers "it did not exist, and now
   * it does, and it dies in N seconds" in one indivisible step, so the decision
   * cannot be split by a concurrent caller the way a check and a later set was.
   */
  private async claimWindow(
    identity: string,
    kind: ResendKind,
  ): Promise<boolean> {
    try {
      const reply = await this.redis.set(
        this.cooldownKey(identity),
        '1',
        'EX',
        this.cooldownSeconds,
        'NX',
      );
      return reply !== null;
    } catch (err) {
      this.unavailable(err, kind);
      return true;
    }
  }

  /**
   * Spend one of this window's sends, and refuse once they are gone.
   *
   * `INCR` then `EXPIRE` on the first one, exactly as `LoginThrottleService`
   * counts failures: the window is anchored on the first send rather than
   * sliding, which lets a determined caller take up to twice the budget across
   * a boundary. That is accounted for where the limit is set, and the
   * alternative — a sorted set of timestamps per account — buys a factor of two
   * for a second data structure and a second idiom.
   *
   * Refused requests keep incrementing, and deliberately do not extend the
   * window: nothing was sent, so there is nothing to pay for, and a counter
   * that reset its own TTL on every refusal would turn hammering into a
   * permanent lockout.
   */
  private async spendFromBudget(
    identity: string,
    kind: ResendKind,
  ): Promise<void> {
    const key = this.budgetKey(identity);
    let spent = 0;
    let secondsLeft = this.windowSeconds;
    try {
      spent = await this.redis.incr(key);
      if (spent === 1) {
        await this.redis.expire(key, this.windowSeconds);
      } else if (spent > this.maxPerWindow) {
        secondsLeft = await this.remainingWindow(key);
      }
    } catch (err) {
      this.unavailable(err, kind);
      return;
    }
    if (spent > this.maxPerWindow) {
      throw DomainException.tooManyRequests(budgetMessage(secondsLeft));
    }
  }

  /**
   * How long this window has left, and the one repair this service makes.
   *
   * A counter with no expiry (`-1`) should be impossible — the window is
   * applied immediately after the first send is counted — but a process that
   * died between those two calls would leave one, and a budget key that never
   * expires is a member who can never confirm a number again, with no screen
   * anywhere that could clear it. Re-anchoring it costs at most one extra
   * window and is unreachable while a real TTL is standing. `-2` is no key at
   * all, which the next request will allow anyway.
   */
  private async remainingWindow(key: string): Promise<number> {
    const left = await this.redis.ttl(key);
    if (left >= 0) return left;
    if (left === -2) return 0;
    await this.redis.expire(key, this.windowSeconds);
    return this.windowSeconds;
  }

  /**
   * Redis could not be reached. Refuse or allow per the kind, and say so
   * without naming the identity — it is PII, and the error may carry more.
   */
  private unavailable(err: unknown, kind: ResendKind): void {
    this.logger.warn(
      { kind },
      err instanceof Error
        ? `resend throttle unavailable (${err.name})`
        : 'resend throttle unavailable',
    );
    if (FAIL_CLOSED[kind]) {
      throw DomainException.tooManyRequests(WAIT_MESSAGE[kind]);
    }
  }

  private cooldownKey(identity: string): string {
    return `verify:resend:${identity}`;
  }

  private budgetKey(identity: string): string {
    return `verify:budget:${identity}`;
  }
}
