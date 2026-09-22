import { HttpStatus } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { DomainException } from '../../common/errors/domain.exception';
import type { Env } from '../../config/env.validation';
import { LoginThrottleService } from './login-throttle.service';

const MAX = 3;
const LOCK = 900;
const ID = 'acme|admin|owner@acme.co.th';

describe('LoginThrottleService', () => {
  let redis: jest.Mocked<Redis>;
  let service: LoginThrottleService;

  beforeEach(() => {
    redis = {
      ttl: jest.fn(),
      incr: jest.fn(),
      expire: jest.fn().mockResolvedValue(1),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    } as unknown as jest.Mocked<Redis>;
    const config = {
      get: jest.fn((key: string) =>
        key === 'LOGIN_MAX_ATTEMPTS' ? MAX : LOCK,
      ),
    } as unknown as ConfigService<Env, true>;
    service = new LoginThrottleService(redis, config);
  });

  describe('assertNotLocked', () => {
    // -2 is Redis for "no such key" — nothing is locked.
    it('passes when the identity is not locked', async () => {
      redis.ttl.mockResolvedValue(-2);
      await expect(service.assertNotLocked(ID)).resolves.toBeUndefined();
    });

    it('throws 429 when the identity is locked', async () => {
      redis.ttl.mockResolvedValue(LOCK);
      let status: number | undefined;
      try {
        await service.assertNotLocked(ID);
      } catch (err) {
        status = (err as DomainException).getStatus();
      }
      expect(status).toBe(HttpStatus.TOO_MANY_REQUESTS);
    });

    /**
     * The refusal carries the wait, so somebody locked out of their own account
     * can tell a coffee break from a lost afternoon. `lockedMessage` owns the
     * wording; this only proves the remaining time reaches it.
     */
    it('says how long is left', async () => {
      redis.ttl.mockResolvedValue(LOCK);
      let message: string | undefined;
      try {
        await service.assertNotLocked(ID);
      } catch (err) {
        message = (err as DomainException).message;
      }
      expect(message).toBe(
        'Too many sign-in attempts. Try again in 15 minutes.',
      );
    });

    // The old wording offered one, and the lock is checked before any password
    // is read — so it named a remedy that could not work.
    it('does not suggest a password reset', async () => {
      redis.ttl.mockResolvedValue(LOCK);
      await expect(service.assertNotLocked(ID)).rejects.not.toThrow(/reset/i);
    });

    it('fails open (allows) when Redis is unavailable', async () => {
      redis.ttl.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(service.assertNotLocked(ID)).resolves.toBeUndefined();
    });
  });

  describe('recordFailure', () => {
    it('sets a TTL on the first failure and does not lock yet', async () => {
      redis.incr.mockResolvedValue(1);
      await service.recordFailure(ID);
      expect(redis.expire).toHaveBeenCalledWith('login:fail:' + ID, LOCK);
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('locks the identity once the limit is reached', async () => {
      redis.incr.mockResolvedValue(MAX);
      await service.recordFailure(ID);
      expect(redis.set).toHaveBeenCalledWith(
        'login:lock:' + ID,
        '1',
        'EX',
        LOCK,
      );
    });

    it('does not lock below the limit', async () => {
      redis.incr.mockResolvedValue(MAX - 1);
      await service.recordFailure(ID);
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('fails open when Redis is unavailable', async () => {
      redis.incr.mockRejectedValue(new Error('down'));
      await expect(service.recordFailure(ID)).resolves.toBeUndefined();
    });
  });

  /**
   * The forgotten-password form counts its misses on the same limit, but never
   * in the same bucket. An identity is just a string, and sign-in builds its
   * own from a workspace slug the caller types — so if the two shared keys, a
   * workspace named to match the reset form's prefix would let failed sign-ins
   * lock somebody's reset form, and reset misses lock their sign-in.
   */
  describe('the reset form keeps its own count', () => {
    it('counts a reset miss under keys no sign-in attempt can reach', async () => {
      redis.incr.mockResolvedValue(MAX);
      await service.recordFailure(ID, 'reset');
      expect(redis.incr).toHaveBeenCalledWith('reset:fail:' + ID);
      expect(redis.set).toHaveBeenCalledWith(
        'reset:lock:' + ID,
        '1',
        'EX',
        LOCK,
      );
    });

    it('checks the reset lock, not the sign-in lock, for a reset', async () => {
      redis.ttl.mockResolvedValue(-2);
      await service.assertNotLocked(ID, 'reset');
      expect(redis.ttl).toHaveBeenCalledWith('reset:lock:' + ID);
    });

    it('leaves sign-in on the keys it has always used', async () => {
      redis.incr.mockResolvedValue(1);
      redis.ttl.mockResolvedValue(-2);
      await service.recordFailure(ID);
      await service.assertNotLocked(ID);
      expect(redis.incr).toHaveBeenCalledWith('login:fail:' + ID);
      expect(redis.ttl).toHaveBeenCalledWith('login:lock:' + ID);
    });
  });

  it('clears the counter and lock on success', async () => {
    await service.recordSuccess(ID);
    expect(redis.del).toHaveBeenCalledWith(
      'login:fail:' + ID,
      'login:lock:' + ID,
    );
  });
});
