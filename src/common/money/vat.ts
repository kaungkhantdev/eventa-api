export interface VatBreakdown {
  /** The VAT-inclusive price the attendee pays (integer satang). */
  grossSatang: number;
  /** Ex-VAT amount (integer satang). */
  netSatang: number;
  /** The embedded VAT (integer satang). */
  vatSatang: number;
}

/**
 * Split a VAT-INCLUSIVE gross price into net + VAT. Prices in Eventa are stored
 * gross (what the attendee pays); `rate` is the fraction (0.07 for 7%). Rounds
 * the VAT to the nearest satang and derives net as `gross - vat`, so the parts
 * always sum back to gross exactly (no rounding drift).
 */
export function vatInclusiveBreakdown(
  grossSatang: number,
  rate: number,
): VatBreakdown {
  const vatSatang = Math.round((grossSatang * rate) / (1 + rate));
  return { grossSatang, netSatang: grossSatang - vatSatang, vatSatang };
}
