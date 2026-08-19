import { vatInclusiveBreakdown } from '../../common/money/vat';
import type { DiscountSnapshot } from './discounts.types';

const PERCENT_DIVISOR = 100;

/** What a code is worth against a given order, with VAT restated on the result. */
export interface DiscountQuote {
  /** Taken off the order (integer satang); never more than the order itself. */
  discountSatang: number;
  /** What the attendee pays after the discount, VAT included. */
  totalSatang: number;
  /** The ex-VAT part of `totalSatang`. */
  netSatang: number;
  /** The VAT embedded in `totalSatang` — recalculated on the reduced amount. */
  vatSatang: number;
}

/**
 * Apply a code to a VAT-inclusive subtotal (US-TKT-11).
 *
 * Two invariants hold for every input, and the spec checks them exhaustively:
 *   · `discountSatang + totalSatang === subtotalSatang` — no satang appears or
 *     vanishes, so the order always reconciles.
 *   · `netSatang + vatSatang === totalSatang` — VAT is recalculated on what is
 *     actually charged, never carried over from the pre-discount price.
 *
 * A percentage rounds **down**, so rounding can only ever favour the organizer by
 * a satang, never hand away money that was not authorised.
 */
export function quoteDiscount(
  code: DiscountSnapshot,
  subtotalSatang: number,
  vatRate: number,
): DiscountQuote {
  const raw =
    code.type === 'percent'
      ? Math.floor((subtotalSatang * code.value) / PERCENT_DIVISOR)
      : code.value;
  // Capped at the order: a ฿300 code on a ฿250 order takes ฿250, not the total
  // below zero.
  const discountSatang = Math.max(0, Math.min(raw, subtotalSatang));
  const totalSatang = subtotalSatang - discountSatang;
  const { netSatang, vatSatang } = vatInclusiveBreakdown(totalSatang, vatRate);
  return { discountSatang, totalSatang, netSatang, vatSatang };
}
