import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { Env } from '../../config/env.validation';
import { REDIS } from './redis.constants';

/**
 * How long any one command may wait before it is given up on.
 *
 * This is what makes "fail-open" true rather than aspirational.
 * `maxRetriesPerRequest` counts RECONNECTION ATTEMPTS, and each attempt waits
 * out its own connect timeout — so against a host that drops packets instead
 * of refusing them (a firewall or security-group change, a withdrawn route) a
 * single `TTL` measured 30.2 seconds before it rejected. Every consumer here
 * catches and carries on, but it cannot carry on until the command settles,
 * so a sign-in sat for half a minute and the pool filled up behind it.
 *
 * `commandTimeout` is the only option that bounds a command irrespective of
 * what the connection is doing. Short on purpose: Redis is on the same network
 * and answers in single-digit milliseconds, so anything slower than this is an
 * outage, and the throttles would rather allow an attempt than hold a request.
 */
export const COMMAND_TIMEOUT_MS = 250;

/** Bounds one connection attempt; `commandTimeout` bounds the wait regardless. */
export const CONNECT_TIMEOUT_MS = 1_000;

/** Rejects a queued command rather than retrying it for as long as it takes. */
export const MAX_RETRIES_PER_REQUEST = 2;

/**
 * Global ioredis client (cache / rate-limit / idempotency — ADR-6). Uses REDIS_URL
 * when set, else the local default. Lazy-connects so the app boots even if Redis is
 * briefly unavailable; consumers that need it degrade gracefully (fail-open) — see
 * `COMMAND_TIMEOUT_MS` for what that costs without a bound on each command.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const url = config.get('REDIS_URL', { infer: true });
        const options = {
          maxRetriesPerRequest: MAX_RETRIES_PER_REQUEST,
          lazyConnect: true,
          commandTimeout: COMMAND_TIMEOUT_MS,
          connectTimeout: CONNECT_TIMEOUT_MS,
        };
        return url ? new Redis(url, options) : new Redis(options);
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
