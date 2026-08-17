import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation';
import { OrderExpiryService } from './order-expiry.service';

/**
 * Runs the expiry sweep on a timer.
 *
 * Deliberately inside the API rather than a third deployable. The outbox relay
 * is separate because it owns a RabbitMQ connection and its own failure mode;
 * this owns one idempotent UPDATE. Every replica running it concurrently is
 * harmless — the statement selects by the data and holds no cursor, so two
 * sweeps racing simply find nothing the second time. Making it a separate
 * process would buy nothing and add one more thing to forget to start.
 *
 * A failed tick is logged and dropped, never rethrown: an unhandled rejection
 * in a timer takes the whole API down, and a database blip during a sweep is
 * not a reason to stop serving requests. The next tick retries the same rows.
 */
@Injectable()
export class OrderExpiryScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderExpiryScheduler.name);
  private readonly everyMs: number;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly expiry: OrderExpiryService,
    config: ConfigService<Env, true>,
  ) {
    this.everyMs = config.get('ORDER_EXPIRY_SWEEP_MS', { infer: true });
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), this.everyMs);
    // Never hold the process open on our account: a shutting-down API should
    // not wait out a sweep interval before it can exit.
    this.timer.unref();
    this.logger.log(`order expiry sweep every ${this.everyMs}ms`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    try {
      await this.expiry.sweep();
    } catch (err) {
      this.logger.error({ err }, 'order expiry sweep failed');
    }
  }
}
