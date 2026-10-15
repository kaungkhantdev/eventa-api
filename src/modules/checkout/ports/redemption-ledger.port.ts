import type { Tx } from '../../../db/tenant';

/** One use of a discount code, by the order that used it. */
export interface Redemption {
  organizationId: number;
  discountCodeId: string;
  orderId: string;
  buyerEmail: string;
  amountSatang: number;
}

/**
 * Checkout's way to record that an order used a discount code, INSIDE the
 * order's own transaction (US-TKT-11), so the order and the code's count commit
 * or roll back together. Checkout owns the abstraction (DIP); Discounts binds
 * the adapter, because the redemption row and the code's `used` count are both
 * its tables, and only it knows what a spent limit means.
 */
export abstract class RedemptionLedgerPort {
  /**
   * Records the use and counts it against the code. A second call for the same
   * order is a no-op. Throws a validation error when the code's limit is
   * already spent, which rolls the order back with it.
   */
  abstract redeemIn(tx: Tx, redemption: Redemption): Promise<void>;
}
