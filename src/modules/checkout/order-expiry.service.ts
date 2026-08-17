import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Clock } from '../../common/time/clock';
import type { Env } from '../../config/env.validation';
import { CheckoutRepository } from './checkout.repository';

/**
 * Closes the orders nobody paid for (US-DISC-05).
 *
 * A checkout reserves seats, places a `pending` order, and sends the buyer to
 * the provider. Most come back. The ones who don't used to leave the order
 * pending forever: the hold quietly lapsed, the seats returned to sale, and the
 * order sat there claiming to be waiting for money that was never coming. The
 * buyer's own copy of it said "your tickets are issued the moment the payment
 * clears" indefinitely.
 *
 * This is the other half of that bargain. One job: decide nothing, format
 * nothing, just ask the repository to close what has demonstrably lapsed and
 * say how much it closed. The timer that calls it lives next door in
 * `OrderExpiryScheduler`, so this stays a plain function anything can invoke —
 * a test, a scheduler, or an operator draining a backlog by hand.
 */
@Injectable()
export class OrderExpiryService {
  private readonly logger = new Logger(OrderExpiryService.name);
  private readonly graceMs: number;
  private readonly batch: number;

  constructor(
    private readonly repo: CheckoutRepository,
    private readonly clock: Clock,
    config: ConfigService<Env, true>,
  ) {
    this.graceMs = config.get('ORDER_EXPIRY_GRACE_MS', { infer: true });
    this.batch = config.get('ORDER_EXPIRY_BATCH', { infer: true });
  }

  /** Close one batch of lapsed orders. Returns how many. */
  async sweep(): Promise<number> {
    const closed = await this.repo.expireLapsedOrders({
      now: this.clock.now(),
      graceMs: this.graceMs,
      limit: this.batch,
    });
    if (closed.length > 0) {
      // References, not ids: this is the number an organizer would be asked
      // about, and it is not a secret the way an order's uuid is.
      this.logger.log(
        { count: closed.length, references: closed.map((o) => o.reference) },
        'expired unpaid orders',
      );
    }
    return closed.length;
  }
}
