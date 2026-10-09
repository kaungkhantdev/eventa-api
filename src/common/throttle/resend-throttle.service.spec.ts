import type { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import type { Env } from '../../config/env.validation';
import { DomainException } from '../errors/domain.exception';
import { ResendThrottleService } from './resend-throttle.service';

const config = () => ({ get: () => 60 }) as unknown as ConfigService<Env, true>;

/** A Redis that cannot be reached — the outage both cases are about. */
const unreachable = () =>
  ({
    exists: () => Promise.reject(new Error('ECONNREFUSED')),
  }) as unknown as Redis;

const reachable = (recent: number) =>
  ({
    exists: () => Promise.resolve(recent),
    set: () => Promise.resolve('OK'),
  }) as unknown as Redis;

describe('ResendThrottleService', () => {
  it('allows a first send', async () => {
    const throttle = new ResendThrottleService(reachable(0), config());

    await expect(
      throttle.assertAllowed('u-1', 'code'),
    ).resolves.toBeUndefined();
  });

  it('refuses one still in the cool-off', async () => {
    const throttle = new ResendThrottleService(reachable(1), config());

    await expect(throttle.assertAllowed('u-1', 'code')).rejects.toBeInstanceOf(
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

      await expect(
        throttle.assertAllowed('u-1', 'code'),
      ).rejects.toBeInstanceOf(DomainException);
    });

    // A link still fails open: refusing it locks somebody out of their own
    // account over an outage that is not their fault, for the cost of one email.
    it('still allows a link, which is the cheaper mistake', async () => {
      const throttle = new ResendThrottleService(unreachable(), config());

      await expect(
        throttle.assertAllowed('u-1', 'link'),
      ).resolves.toBeUndefined();
    });
  });
});
