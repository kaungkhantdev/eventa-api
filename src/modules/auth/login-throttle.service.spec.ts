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
      exists: jest.fn(),
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
    it('passes when the identity is not locked', async () => {
      redis.exists.mockResolvedValue(0);
      await expect(service.assertNotLocked(ID)).resolves.toBeUndefined();
    });

    it('throws 429 when the identity is locked', async () => {
      redis.exists.mockResolvedValue(1);
      let status: number | undefined;
      try {
        await service.assertNotLocked(ID);
      } catch (err) {
        status = (err as DomainException).getStatus();
      }
      expect(status).toBe(HttpStatus.TOO_MANY_REQUESTS);
    });

    it('fails open (allows) when Redis is unavailable', async () => {
      redis.exists.mockRejectedValue(new Error('ECONNREFUSED'));
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

  it('clears the counter and lock on success', async () => {
    await service.recordSuccess(ID);
    expect(redis.del).toHaveBeenCalledWith(
      'login:fail:' + ID,
      'login:lock:' + ID,
    );
  });
});
