import type { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import type { Env } from '../../config/env.validation';
import { DomainException } from '../errors/domain.exception';
import { ResendThrottleService } from './resend-throttle.service';

const COOLDOWN = 60;
const WINDOW = 7200;
/** Smaller than the shipped default; three sends is three lines of test. */
const MAX_PER_WINDOW = 3;

/** The three knobs this service reads, answered by name rather than in order. */
const config = () =>
  ({
    get: (key: keyof Env) => {
      if (key === 'VERIFY_CODE_MAX_PER_WINDOW') return MAX_PER_WINDOW;
      if (key === 'VERIFY_CODE_WINDOW_SECONDS') return WINDOW;
      return COOLDOWN;
    },
  }) as unknown as ConfigService<Env, true>;

/**
 * An in-memory Redis that honours the two things under test: `NX` refuses a key
 * that already exists, and keys expire.
 *
 * A stub that answered `exists` would prove nothing here. The bug this file is
 * about was that one caller's EXISTS ran before another caller's SET, so the
 * fake has to be able to tell a claim that won from one that lost — which means
 * modelling the keyspace rather than the replies.
 */
function fakeRedis() {
  const values = new Map<string, number>();
  const expiresAt = new Map<string, number>();
  let now = 0;

  const reap = (key: string): void => {
    const at = expiresAt.get(key);
    if (at !== undefined && at <= now) {
      values.delete(key);
      expiresAt.delete(key);
    }
  };

  const redis = {
    set: (key: string, _v: string, _ex: 'EX', seconds: number, nx?: 'NX') => {
      reap(key);
      if (nx === 'NX' && values.has(key)) return Promise.resolve(null);
      values.set(key, 1);
      expiresAt.set(key, now + seconds);
      return Promise.resolve('OK');
    },
    incr: (key: string) => {
      reap(key);
      const next = (values.get(key) ?? 0) + 1;
      values.set(key, next);
      return Promise.resolve(next);
    },
    expire: (key: string, seconds: number) => {
      expiresAt.set(key, now + seconds);
      return Promise.resolve(1);
    },
    ttl: (key: string) => {
      reap(key);
      if (!values.has(key)) return Promise.resolve(-2);
      const at = expiresAt.get(key);
      return Promise.resolve(at === undefined ? -1 : at - now);
    },
  };

  return {
    redis: redis as unknown as Redis,
    /** Let time pass, so a cool-off or a window can lapse. */
    advance: (seconds: number) => {
      now += seconds;
    },
    keys: () => [...values.keys()],
  };
}

/** A Redis that cannot be reached — the outage the two kinds diverge over. */
const unreachable = () =>
  ({
    exists: () => Promise.reject(new Error('ECONNREFUSED')),
    set: () => Promise.reject(new Error('ECONNREFUSED')),
    incr: () => Promise.reject(new Error('ECONNREFUSED')),
  }) as unknown as Redis;

const reachable = (recent: number) =>
  ({
    exists: () => Promise.resolve(recent),
    set: () => Promise.resolve('OK'),
  }) as unknown as Redis;

const messageOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (err) {
    return (err as DomainException).message;
  }
  throw new Error('expected a refusal');
};

describe('ResendThrottleService', () => {
  describe('assertAllowed (the sign-up link still checks and sets separately)', () => {
    it('allows a first send', async () => {
      const throttle = new ResendThrottleService(reachable(0), config());

      await expect(
        throttle.assertAllowed('u-1', 'code'),
      ).resolves.toBeUndefined();
    });

    it('refuses one still in the cool-off', async () => {
      const throttle = new ResendThrottleService(reachable(1), config());

      await expect(
        throttle.assertAllowed('u-1', 'code'),
      ).rejects.toBeInstanceOf(DomainException);
    });

    // Sign-up's confirmation email is the one caller left on this pair, and it
    // is a `link`, so an outage must not stand between somebody and their own
    // account. The `code` kind's divergence is covered under `claim`.
    it('fails open for a link when the throttle is unreachable', async () => {
      const throttle = new ResendThrottleService(unreachable(), config());

      await expect(
        throttle.assertAllowed('u-1', 'link'),
      ).resolves.toBeUndefined();
    });
  });

  describe('claim', () => {
    it('allows a first send and refuses the next inside the cool-off', async () => {
      const { redis } = fakeRedis();
      const throttle = new ResendThrottleService(redis, config());

      await expect(throttle.claim('u-1', 'code')).resolves.toBeUndefined();
      await expect(throttle.claim('u-1', 'code')).rejects.toMatchObject({
        code: 'RATE_LIMITED',
      });
    });

    it('lets the cool-off lapse', async () => {
      const { redis, advance } = fakeRedis();
      const throttle = new ResendThrottleService(redis, config());

      await throttle.claim('u-1', 'code');
      advance(COOLDOWN);

      await expect(throttle.claim('u-1', 'code')).resolves.toBeUndefined();
    });

    /*
     * THE RACE THE SINGLE CALL EXISTS FOR.
     *
     * `assertAllowed` asked EXISTS, the caller then did its work, and only
     * afterwards did `remember` SET the key. Every request that asked before
     * the first one set passed — so one 60-second cool-off issued as many codes
     * as arrived at once, each a paid SMS to a requester-chosen number and each
     * one RESETTING `phone_code_attempts`, which multiplied the guess budget
     * instead of bounding it.
     *
     * `SET NX` decides it in one round trip: exactly one caller is told it won.
     */
    it('admits exactly one of a burst, however many arrive at once', async () => {
      const { redis } = fakeRedis();
      const throttle = new ResendThrottleService(redis, config());

      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          throttle.claim('u-1', 'code').then(
            () => 'sent',
            () => 'refused',
          ),
        ),
      );

      expect(results.filter((r) => r === 'sent')).toHaveLength(1);
    });

    /**
     * The window is claimed BEFORE the work, so a request that then fails still
     * costs one. Under the old order `remember` came last and was skipped
     * whenever the write returned null or threw — a failed attempt cost the
     * caller nothing, which is the one case a caller can arrange on purpose.
     */
    it('keeps the window claimed even if the caller then fails', async () => {
      const { redis } = fakeRedis();
      const throttle = new ResendThrottleService(redis, config());

      await throttle.claim('u-1', 'code');
      // whatever the caller was going to send blew up here; nothing refunds it

      await expect(throttle.claim('u-1', 'code')).rejects.toBeInstanceOf(
        DomainException,
      );
    });

    describe('when the throttle itself is unreachable', () => {
      /*
       * The two kinds diverge here deliberately, and the divergence is the point.
       *
       * A `code` that escapes the cool-off is a paid SMS to a requester-chosen
       * number AND a reset of `users.phone_code_attempts` — so failing open
       * handed out unlimited fresh guess budgets against a six-digit secret and
       * billed for each. Nothing else bounded it: the Postgres attempt cap is
       * fail-closed within one code's life and says nothing about how many codes
       * exist, though this service's docstring used to claim otherwise.
       */
      it('refuses a code rather than issuing an unbounded one', async () => {
        const throttle = new ResendThrottleService(unreachable(), config());

        await expect(throttle.claim('u-1', 'code')).rejects.toBeInstanceOf(
          DomainException,
        );
      });

      // A link still fails open: refusing it locks somebody out of their own
      // account over an outage that is not their fault, for one email.
      it('still allows a link, which is the cheaper mistake', async () => {
        const throttle = new ResendThrottleService(unreachable(), config());

        await expect(throttle.claim('u-1', 'link')).resolves.toBeUndefined();
      });
    });
  });

  /**
   * The cool-off alone bounds the RATE and not the TOTAL: one code every 60
   * seconds, for ever, is ~1,440 codes and ~7,200 guesses a day against a
   * six-digit secret — plus 1,440 paid texts to numbers the requester chose.
   * Sign-in answers "too many tries" with a lockout after a handful; this is the
   * same answer for "too many sends".
   */
  describe('the per-window budget', () => {
    const spend = async (
      throttle: ResendThrottleService,
      advance: (s: number) => void,
      sends: number,
    ): Promise<void> => {
      for (let i = 0; i < sends; i++) {
        await throttle.claim('u-1', 'code');
        advance(COOLDOWN);
      }
    };

    it('lets the configured number of codes through, and not one more', async () => {
      const { redis, advance } = fakeRedis();
      const throttle = new ResendThrottleService(redis, config());

      await spend(throttle, advance, MAX_PER_WINDOW);

      await expect(throttle.claim('u-1', 'code')).rejects.toMatchObject({
        code: 'RATE_LIMITED',
      });
    });

    it('refuses for the rest of the window, not just the cool-off', async () => {
      const { redis, advance } = fakeRedis();
      const throttle = new ResendThrottleService(redis, config());

      await spend(throttle, advance, MAX_PER_WINDOW);
      advance(COOLDOWN * 10);

      await expect(throttle.claim('u-1', 'code')).rejects.toBeInstanceOf(
        DomainException,
      );
    });

    it('hands the budget back once the window has passed', async () => {
      const { redis, advance } = fakeRedis();
      const throttle = new ResendThrottleService(redis, config());

      await spend(throttle, advance, MAX_PER_WINDOW);
      advance(WINDOW);

      await expect(throttle.claim('u-1', 'code')).resolves.toBeUndefined();
    });

    /**
     * Confirming does NOT refund the sends. They were paid for and cannot be
     * un-sent, and an attacker holding one number they can confirm would
     * otherwise reset the budget at will.
     */
    it('counts sends per account, so another account is unaffected', async () => {
      const { redis, advance } = fakeRedis();
      const throttle = new ResendThrottleService(redis, config());

      await spend(throttle, advance, MAX_PER_WINDOW);

      await expect(throttle.claim('u-2', 'code')).resolves.toBeUndefined();
    });

    /**
     * What the refusal says to somebody who is not an attacker. A dead end with
     * no wait and no next step sends a member who simply cannot receive texts
     * to hammer the form, which is the behaviour this is trying to stop.
     */
    it('says how long is left and what to try instead', async () => {
      const { redis, advance } = fakeRedis();
      const throttle = new ResendThrottleService(redis, config());

      await spend(throttle, advance, MAX_PER_WINDOW);
      const message = await messageOf(throttle.claim('u-1', 'code'));

      // WINDOW is two hours, and three cool-offs have passed inside it
      expect(message).toContain('2 hours');
      expect(message).toMatch(/receive|arriv/i);
      // and not the cool-off's wording, which asks them to wait a minute
      expect(message).not.toContain('Give it a minute');
    });

    it('rounds the wait up to whole minutes while it is under an hour', async () => {
      const { redis, advance } = fakeRedis();
      const throttle = new ResendThrottleService(redis, config());

      await spend(throttle, advance, MAX_PER_WINDOW);
      advance(WINDOW - COOLDOWN * MAX_PER_WINDOW - 90);
      const message = await messageOf(throttle.claim('u-1', 'code'));

      expect(message).toContain('2 minutes');
    });

    /**
     * A counter with no expiry should be impossible — the window is applied
     * right after the first send is counted — but a process that died between
     * those two calls would leave one, and a budget key that never expires is a
     * member who can never confirm a number again. There is no admin screen for
     * a Redis key, so the refusal path repairs it.
     */
    it('re-anchors a budget key that lost its expiry, instead of a dead end', async () => {
      const { redis } = fakeRedis();
      const throttle = new ResendThrottleService(redis, config());
      const key = `verify:budget:u-1`;
      // a counter left behind mid-write: over the cap, and immortal
      for (let i = 0; i <= MAX_PER_WINDOW; i++) await redis.incr(key);
      expect(await redis.ttl(key)).toBe(-1);

      await expect(throttle.claim('u-1', 'code')).rejects.toBeInstanceOf(
        DomainException,
      );

      expect(await redis.ttl(key)).toBe(WINDOW);
    });

    /**
     * A link is not budgeted. It costs no money, it resets no guess budget, and
     * refusing somebody their own confirmation email for the rest of the day is
     * a worse failure than another email.
     */
    it('does not budget a link', async () => {
      const { redis, advance } = fakeRedis();
      const throttle = new ResendThrottleService(redis, config());

      for (let i = 0; i < MAX_PER_WINDOW + 2; i++) {
        await expect(throttle.claim('u-3', 'link')).resolves.toBeUndefined();
        advance(COOLDOWN);
      }
    });
  });
});
