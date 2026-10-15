import { Injectable } from '@nestjs/common';
import { and, eq, lt, or, sql } from 'drizzle-orm';
import { DomainException } from '../../common/errors/domain.exception';
import { discountCodes, discountRedemptions } from '../../db/schema';
import type { Tx } from '../../db/tenant';
import {
  RedemptionLedgerPort,
  type Redemption,
} from '../checkout/ports/redemption-ledger.port';

/** A redemption limit of 0 means unlimited — mirrors `DiscountsPolicy`. */
const UNLIMITED_REDEMPTIONS = 0;
const REDEMPTION_LIMIT_REACHED = 'This code has reached its redemption limit.';

/**
 * Discounts' implementation of Checkout's ledger: the row set that
 * `discount_codes.used` counts (US-TKT-11), and the count itself, moved
 * together in the order's transaction so the two can never disagree.
 */
@Injectable()
export class RedemptionLedgerAdapter extends RedemptionLedgerPort {
  async redeemIn(tx: Tx, redemption: Redemption): Promise<void> {
    const recorded = await tx
      .insert(discountRedemptions)
      .values(redemption)
      .onConflictDoNothing()
      .returning({ id: discountRedemptions.id });
    if (recorded.length === 0) return;
    await this.count(tx, redemption.organizationId, redemption.discountCodeId);
  }

  /**
   * One more use of the code, refused once its limit is spent. The quote checked
   * the limit before this transaction opened; this conditional update is what
   * holds when two buyers race for the last one, and the loser's whole order
   * rolls back. The final redemption expires the code on the spot
   * (US-TKT-10) — unless the organizer switched it off, which is never derived
   * away.
   */
  private async count(
    tx: Tx,
    organizationId: number,
    discountCodeId: string,
  ): Promise<void> {
    const counted = await tx
      .update(discountCodes)
      .set({
        used: sql`${discountCodes.used} + 1`,
        status: sql`CASE
          WHEN ${discountCodes.status} <> 'disabled'
            AND ${discountCodes.redemptionLimit} <> ${UNLIMITED_REDEMPTIONS}
            AND ${discountCodes.used} + 1 >= ${discountCodes.redemptionLimit}
          THEN 'expired' ELSE ${discountCodes.status} END`,
      })
      .where(
        and(
          eq(discountCodes.id, discountCodeId),
          eq(discountCodes.organizationId, organizationId),
          or(
            eq(discountCodes.redemptionLimit, UNLIMITED_REDEMPTIONS),
            lt(discountCodes.used, discountCodes.redemptionLimit),
          ),
        ),
      )
      .returning({ id: discountCodes.id });
    if (counted.length === 0) {
      throw DomainException.validation(REDEMPTION_LIMIT_REACHED);
    }
  }
}
