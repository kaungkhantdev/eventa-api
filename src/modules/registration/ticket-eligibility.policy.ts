import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import type {
  TicketEligibility,
  TicketStatus,
} from './ports/ticket-eligibility.port';

const ONSALE = 'onsale' satisfies TicketStatus;

/** Buyer-facing reason a tier that is not `onsale` cannot be sold right now. */
const NOT_ON_SALE_MESSAGE: Record<
  Exclude<TicketStatus, typeof ONSALE>,
  string
> = {
  scheduled: "This ticket type isn't on sale yet.",
  paused: 'Sales for this ticket type are paused.',
  soldout: 'This ticket type is sold out.',
};

/**
 * Per-tier sales eligibility for the checkout/reservation layer (US-TKT-03): a
 * buyer may only hold or purchase a tier that is `onsale`, inside its sales window,
 * and in a quantity within the tier's own per-order bounds. Pure and stateless —
 * it decides on a `TicketEligibility` snapshot; loading it is the port's job, the
 * global 1–8 booking cap stays in `SeatHoldService`, and the oversell check stays
 * in the reservation transaction. Composed by the reservation/checkout services;
 * never inside the raw concurrency engine.
 */
@Injectable()
export class TicketEligibilityPolicy {
  /**
   * Quantity/GA path: the tier must be sellable now and the requested quantity
   * within its per-order bounds (on top of the global 1–8 booking cap).
   */
  assertPurchasable(
    info: TicketEligibility,
    quantity: number,
    now: Date,
  ): void {
    this.assertOnSale(info, now);
    this.assertWithinPerOrderBounds(info, quantity);
  }

  /**
   * Reserved-seat path: the seat's tier must be sellable now. Per-order quantity
   * bounds are enforced per line item at order composition, not per seat.
   */
  assertOnSale(info: TicketEligibility, now: Date): void {
    this.assertSellableStatus(info.status);
    this.assertWithinSalesWindow(info, now);
  }

  private assertSellableStatus(status: TicketStatus): void {
    if (status === ONSALE) return;
    throw DomainException.conflict(NOT_ON_SALE_MESSAGE[status]);
  }

  private assertWithinSalesWindow(info: TicketEligibility, now: Date): void {
    if (info.salesStartAt && now.getTime() < info.salesStartAt.getTime()) {
      throw DomainException.conflict("Ticket sales haven't started yet.");
    }
    if (info.salesEndAt && now.getTime() > info.salesEndAt.getTime()) {
      throw DomainException.conflict('Ticket sales have ended.');
    }
  }

  private assertWithinPerOrderBounds(
    info: TicketEligibility,
    quantity: number,
  ): void {
    if (quantity < info.minPerOrder) {
      throw DomainException.validation(
        `You must buy at least ${info.minPerOrder} of this ticket type per order.`,
      );
    }
    if (quantity > info.maxPerOrder) {
      throw DomainException.validation(
        `You can buy at most ${info.maxPerOrder} of this ticket type per order.`,
      );
    }
  }
}
