/**
 * What Reports needs to know about promotion payback (US-RPT-10), without
 * reading the promotions tables.
 *
 * Implemented by Discounts, which owns `discount_codes` and
 * `discount_redemptions` and already reads `orders` to enforce its own limits.
 */

/** A code's shape, as the organizer set it up. */
export type DiscountKind = 'percent' | 'fixed';

/** Where a code is in its life, as Discounts already settles it. */
export const DISCOUNT_STANDINGS = [
  'active',
  'scheduled',
  'expired',
  'disabled',
] as const;
export type DiscountStanding = (typeof DISCOUNT_STANDINGS)[number];

/** One code's payback. Raw figures only; the shares are the service's. */
export interface DiscountPerformanceRow {
  discountId: string;
  code: string;
  kind: DiscountKind;
  /** Percent for `percent`, integer satang for `fixed`. */
  value: number;
  standing: DiscountStanding;
  /** The event it is scoped to, or null for every event. */
  eventName: string | null;
  redemptions: number;
  /** What the buyers were let off, integer satang. */
  discountSatang: number;
  /**
   * The value of the CONFIRMED orders this code was used on, after the
   * discount came off — integer satang.
   *
   * Order value, deliberately, not settled cash. A promotion's job is to cause
   * orders, and crediting it only once the money clears would make a code look
   * worthless for as long as a bank transfer takes. It is therefore NOT the
   * income report's `net`, and is named to say so.
   */
  influencedSatang: number;
}

export interface DiscountPerformanceQuery {
  /** Codes redeemed inside this window, and codes valid in it. */
  from: Date;
  /** Exclusive. */
  to: Date;
  eventId?: string;
  /** Matches the code itself. */
  search?: string;
  page: number;
  limit: number;
}

export interface DiscountPerformancePage {
  rows: DiscountPerformanceRow[];
  matchedCodes: number;
  /** Summed over the whole filter rather than the page shown. */
  totals: {
    activeCodes: number;
    redemptions: number;
    discountSatang: number;
    influencedSatang: number;
  };
}

export abstract class DiscountReportPort {
  abstract payback(
    organizationId: number,
    query: DiscountPerformanceQuery,
  ): Promise<DiscountPerformancePage>;
}
