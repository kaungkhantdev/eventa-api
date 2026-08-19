import { Injectable } from '@nestjs/common';
import {
  MAX_SEATS_PER_BOOKING,
  SATANG_PER_BAHT,
} from '../../common/booking/booking.limits';
import { DomainException } from '../../common/errors/domain.exception';
import type { TicketStatus } from './ticketing.types';

/** An allocation of 0 means "unlimited" — never sold out, no per-order ceiling. */
const UNLIMITED = 0;

/** The fields that are frozen once a tier has sold a single seat (US-TKT-02). */
interface LockedAfterSales {
  priceSatang?: number;
  isFree?: boolean;
}

interface SoldTier extends LockedAfterSales {
  sold: number;
}

interface AvailabilityInput {
  status: TicketStatus;
  sold: number;
  total: number;
  salesStartAt: Date | null;
  salesEndAt: Date | null;
}

/**
 * The rules a ticket tier must satisfy (US-TKT-01/02/03). Pure and stateless —
 * every method decides on the values handed to it, so the service stays
 * orchestration and the repository stays data access.
 *
 * Note what is deliberately NOT here: whether a buyer may purchase right now.
 * That is the checkout's question, and it lives in Registration's eligibility
 * policy — a closed sales window must refuse a purchase even when this tier's
 * badge still reads "On sale" (US-TKT-03).
 */
@Injectable()
export class TicketingPolicy {
  /** A window must move forwards; a zero-length one would sell nothing. */
  assertSalesWindow(startAt: Date | null, endAt: Date | null): void {
    if (!startAt || !endAt) return;
    if (endAt.getTime() > startAt.getTime()) return;
    throw DomainException.validation(
      'The sales end date must come after the sales start date.',
    );
  }

  /**
   * The per-order limit sits inside two ceilings: the platform booking cap, and
   * the tier's own allocation — offering more seats per order than exist would
   * strand every buyer at checkout.
   */
  assertPerOrderBounds(
    minPerOrder: number,
    maxPerOrder: number,
    total: number,
  ): void {
    if (maxPerOrder > MAX_SEATS_PER_BOOKING) {
      throw DomainException.validation(
        `A per-order limit can't exceed ${MAX_SEATS_PER_BOOKING} seats.`,
      );
    }
    if (minPerOrder < 1 || minPerOrder > maxPerOrder) {
      throw DomainException.validation(
        'The minimum per order must be at least 1 and no more than the maximum.',
      );
    }
    if (total !== UNLIMITED && maxPerOrder > total) {
      throw DomainException.validation(
        `The per-order limit (${maxPerOrder}) can't exceed the ${total} seats available.`,
      );
    }
  }

  /** Prices are set in whole baht; the attendee-facing total adds VAT later. */
  assertWholeBaht(priceSatang: number): void {
    if (priceSatang % SATANG_PER_BAHT === 0) return;
    throw DomainException.validation(
      'Prices are set in whole baht — drop the stray satang.',
    );
  }

  /**
   * Once a seat is sold, price and paid/free are frozen: the people holding
   * tickets bought a specific deal, and rewriting it underneath them would
   * corrupt orders already paid for. Re-submitting the same values is fine.
   */
  assertChangeAllowedAfterSales(
    tier: SoldTier,
    input: LockedAfterSales & { name?: string },
  ): void {
    if (tier.sold === 0) return;
    const changesPrice =
      input.priceSatang !== undefined && input.priceSatang !== tier.priceSatang;
    const changesFree =
      input.isFree !== undefined && input.isFree !== tier.isFree;
    if (!changesPrice && !changesFree) return;
    throw DomainException.conflict(
      "The price and paid/free setting can't change after sales began — create a new ticket type instead.",
    );
  }

  /** Capacity may grow freely, but never below the seats already spoken for. */
  assertQuantityNotBelowSold(total: number, sold: number): void {
    if (total >= sold) return;
    throw DomainException.validation(
      `Cannot set the quantity (${total}) below the ${sold} already sold.`,
    );
  }

  /**
   * Availability derived from the window and the inventory (US-TKT-03), so a
   * tier opens and sells out on its own. `paused` is the one state a human owns:
   * it survives until Resume, and nothing here derives it away.
   */
  resolveStatus(tier: AvailabilityInput, now: Date): TicketStatus {
    if (tier.status === 'paused') return 'paused';
    if (this.isExhausted(tier)) return 'soldout';
    if (this.isBeforeWindow(tier, now)) return 'scheduled';
    return 'onsale';
  }

  private isExhausted(tier: { sold: number; total: number }): boolean {
    return tier.total !== UNLIMITED && tier.sold >= tier.total;
  }

  private isBeforeWindow(tier: AvailabilityInput, now: Date): boolean {
    return (
      tier.salesStartAt !== null && now.getTime() < tier.salesStartAt.getTime()
    );
  }
}
