import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { Env } from './config/env.validation';
import { OutboxRelay } from './relay/outbox-relay';
import { RelayModule } from './relay/relay.module';

/**
 * Outbox relay — a SEPARATE deployable from the HTTP API (same image, different
 * entrypoint). Polls `outbox_events` and publishes to RabbitMQ with publisher
 * confirms, marking each published. This is how side effects leave the API
 * without dual-writing (development-guide §8, SAD §6.3/§7.2).
 *
 * Run in dev with `pnpm relay`; in prod as `node dist/relay`.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('Relay');
  const app = await NestFactory.createApplicationContext(RelayModule, {
    bufferLogs: false,
  });
  app.enableShutdownHooks();

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const relay = app.get(OutboxRelay);
  const pollMs = config.get('OUTBOX_POLL_MS', { infer: true });
  const batch = config.get('OUTBOX_BATCH', { infer: true });

  const tick = async (): Promise<void> => {
    try {
      const n = await relay.publishPending(batch);
      if (n > 0) logger.log(`published ${n} event(s)`);
    } catch (err) {
      logger.error({ err }, 'relay tick failed');
    }
  };

  const timer = setInterval(() => void tick(), pollMs);
  const shutdown = () => {
    clearInterval(timer);
    void app.close();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  logger.log(`outbox relay started (poll ${pollMs}ms, batch ${batch})`);
}

void bootstrap();
