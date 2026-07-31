import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { Env } from '../../config/env.validation';
import { REDIS } from './redis.constants';

/**
 * Global ioredis client (cache / rate-limit / idempotency — ADR-6). Uses REDIS_URL
 * when set, else the local default. Lazy-connects so the app boots even if Redis is
 * briefly unavailable; consumers that need it degrade gracefully (fail-open).
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const url = config.get('REDIS_URL', { infer: true });
        const options = { maxRetriesPerRequest: 2, lazyConnect: true };
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
