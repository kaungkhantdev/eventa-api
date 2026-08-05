import { vatInclusiveBreakdown } from '../../common/money/vat';

/** Everything needed to price one order. Rates are fractions (0.07 = 7%). */
export interface PricingInput {
  /** Σ of the line items, VAT-inclusive (Eventa stores gross prices). */
  subtotalSatang: number;
  /** What a discount code is worth here, already quoted by Discounts. */
  discountSatang: number;
  serviceFeeRate: number;
  vatRate: number;
}

/** The order summary an attendee sees, and the numbers written to `orders`. */
export interface OrderTotals {
  subtotalSatang: number;
  discountSatang: number;
  serviceFeeSatang: number;
  /** What the attendee pays, VAT included. */
  totalSatang: number;
  /** The ex-VAT part of `totalSatang`. */
  netSatang: number;
  /** The VAT embedded in `totalSatang`. */
  vatSatang: number;
}

/**
 * Price one order (US-DISC-04's live summary, and what US-DISC-06 records).
 *
 * Two invariants hold for every input, checked exhaustively in the spec:
 *   · `subtotal - discount + fee === total` — the summary the attendee reads
 *     adds up to the amount they are charged, always.
 *   · `net + vat === total` — VAT is restated on what is actually charged, never
 *     carried over from the list price.
 *
 * The service fee is charged on the DISCOUNTED amount — a code should reduce the
 * fee with the ticket, not just the ticket — and rounds **down**, so rounding can
 * never cost the attendee a satang they did not agree to. That is the mirror of
 * `quoteDiscount`, which rounds a percentage down for the organizer's benefit:
 * in both places rounding favours the person who did not set the number.
 *
 * A free order stays free: 5% of nothing is nothing, so "no fees are added"
 * falls out of the arithmetic rather than needing a special case.
 */
export function priceOrder(input: PricingInput): OrderTotals {
  const subtotalSatang = Math.max(0, input.subtotalSatang);
  const discountSatang = clamp(input.discountSatang, subtotalSatang);
  const discounted = subtotalSatang - discountSatang;
  const serviceFeeSatang = Math.floor(discounted * input.serviceFeeRate);
  const totalSatang = discounted + serviceFeeSatang;
  const { netSatang, vatSatang } = vatInclusiveBreakdown(
    totalSatang,
    input.vatRate,
  );
  return {
    subtotalSatang,
    discountSatang,
    serviceFeeSatang,
    totalSatang,
    netSatang,
    vatSatang,
  };
}

/** A discount is worth between nothing and the whole order — never outside it. */
function clamp(value: number, ceiling: number): number {
  return Math.max(0, Math.min(value, ceiling));
}
