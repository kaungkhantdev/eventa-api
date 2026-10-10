import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import { REDIS } from './redis.constants';
import { COMMAND_TIMEOUT_MS, RedisModule } from './redis.module';

/**
 * What a throttle costs when Redis is unreachable.
 *
 * Every consumer of this client is written to fail OPEN: `LoginThrottleService`
 * catches, logs "login throttle unavailable — allowing sign-in", and lets the
 * attempt through. That only holds if the command fails. Against a host that
 * drops packets rather than refusing them — a firewall change, a security
 * group, a vanished VPC endpoint — `maxRetriesPerRequest` alone measured
 * **30.2 seconds** before rejecting, because it counts reconnection attempts
 * and each attempt waits out its own connect timeout. Thirty seconds is not
 * failing open; it is holding every sign-in request until the client gives up.
 *
 * `commandTimeout` is the only option that bounds a command regardless of what
 * the connection is doing. Measured on the same unreachable host: 252ms.
 */
describe('RedisModule', () => {
  /**
   * Built through the real module rather than by calling the factory, so this
   * also pins that the options reach the client — the bound is only worth
   * anything if the provider actually passes it to ioredis.
   *
   * `ConfigService` comes from the app's global `ConfigModule`, which is not
   * imported here; a `@Global` stub is what makes it visible to `RedisModule`
   * without booting env validation. No URL, so ioredis takes its local
   * default and never dials anything — `lazyConnect` means construction opens
   * no socket.
   */
  @Global()
  @Module({
    providers: [{ provide: ConfigService, useValue: { get: () => undefined } }],
    exports: [ConfigService],
  })
  class StubConfigModule {}

  async function client(): Promise<Redis> {
    const moduleRef = await Test.createTestingModule({
      imports: [StubConfigModule, RedisModule],
    }).compile();
    return moduleRef.get<Redis>(REDIS);
  }

  it('bounds every command, so a dead Redis fails open rather than hanging', async () => {
    const redis = await client();

    expect(redis.options.commandTimeout).toBe(COMMAND_TIMEOUT_MS);
    expect(COMMAND_TIMEOUT_MS).toBeLessThan(1_000);

    redis.disconnect();
  });

  /**
   * `lazyConnect` is what lets the app boot without Redis; it is also what
   * makes the timeout necessary, since the first command is the thing that
   * discovers the outage.
   */
  it('still boots without Redis, and never retries a request forever', async () => {
    const redis = await client();

    expect(redis.options.lazyConnect).toBe(true);
    expect(redis.options.maxRetriesPerRequest).toBeGreaterThan(0);

    redis.disconnect();
  });
});
