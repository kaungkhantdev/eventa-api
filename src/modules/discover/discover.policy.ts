import { Injectable } from '@nestjs/common';
import { SATANG_PER_BAHT } from '../../common/booking/booking.limits';
import type { DiscoverBadge, PriceFrom, TierInventory } from './discover.types';

/** An allocation of 0 means unlimited — mirrors `TicketingPolicy`. */
const UNLIMITED = 0;
/** At/above this share of the allocation sold, the card starts nudging. */
const SELLING_FAST_RATIO = 0.9;
const FREE_LABEL = 'Free';
const BAHT_SYMBOL = '฿';
const PRICE_LOCALE = 'en-US';

/**
 * The two judgements a Discover card makes about an event's inventory (US-DISC-01):
 * which urgency badge to wear, and the cheapest way in. Pure and stateless — the
 * service passes the tiers, this decides, so no rule hides in a query.
 *
 * Both read the event as a whole, never one tier: a conference whose VIP block is
 * gone has not sold out while General Admission is wide open.
 */
@Injectable()
export class DiscoverPolicy {
  /**
   * Sold out (Waitlist) beats nearly gone (Selling fast). A paused tier is the
   * organizer's own hold on stock, not exhausted stock, so it keeps the event off
   * the waitlist — its seats may well come back.
   */
  resolveBadge(tiers: TierInventory[]): DiscoverBadge | null {
    if (tiers.length === 0) return null;
    if (this.isSoldOut(tiers)) return 'waitlist';
    return this.isSellingFast(tiers) ? 'selling_fast' : null;
  }

  /** The cheapest tier a visitor could actually buy, or null once none remain. */
  priceFrom(tiers: TierInventory[]): PriceFrom | null {
    const available = tiers.filter((t) => !this.isExhausted(t));
    if (available.length === 0) return null;
    const cheapest = available.reduce((low, t) =>
      t.priceSatang < low.priceSatang ? t : low,
    );
    return { satang: cheapest.priceSatang, isFree: cheapest.isFree };
  }

  /** Satang → the all-in Baht on the card; VAT is already inside the price. */
  label(price: PriceFrom | null): string | null {
    if (price === null) return null;
    if (price.isFree || price.satang === 0) return FREE_LABEL;
    const baht = price.satang / SATANG_PER_BAHT;
    const fraction = baht % 1 === 0 ? 0 : 2;
    return `${BAHT_SYMBOL}${baht.toLocaleString(PRICE_LOCALE, {
      minimumFractionDigits: fraction,
      maximumFractionDigits: 2,
    })}`;
  }

  private isSoldOut(tiers: TierInventory[]): boolean {
    return tiers.every((t) => t.status !== 'paused' && this.isExhausted(t));
  }

  private isSellingFast(tiers: TierInventory[]): boolean {
    const bounded = tiers.filter((t) => t.total !== UNLIMITED);
    if (bounded.length === 0) return false;
    const allocation = bounded.reduce((sum, t) => sum + t.total, 0);
    const sold = bounded.reduce((sum, t) => sum + t.sold, 0);
    return sold >= allocation * SELLING_FAST_RATIO;
  }

  private isExhausted(tier: TierInventory): boolean {
    return tier.total !== UNLIMITED && tier.sold >= tier.total;
  }
}
