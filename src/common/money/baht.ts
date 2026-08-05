const SATANG_PER_BAHT = 100;
const BAHT_SYMBOL = '฿';
/** Grouping/decimal separators, not a translation — ฿ is written the same in TH. */
const PRICE_LOCALE = 'en-US';

/**
 * Render integer satang as the Baht a person reads: `12000` → `฿120`,
 * `12050` → `฿120.50`. Whole baht drop the decimals, because Thai prices
 * overwhelmingly are whole baht and `฿120.00` reads like a rounding error.
 *
 * Formatting only — what a price of zero should SAY ("Free", "RSVP") is the
 * calling module's word, not this function's.
 */
export function formatBaht(satang: number): string {
  const baht = satang / SATANG_PER_BAHT;
  const fraction = Number.isInteger(baht) ? 0 : 2;
  return `${BAHT_SYMBOL}${baht.toLocaleString(PRICE_LOCALE, {
    minimumFractionDigits: fraction,
    maximumFractionDigits: 2,
  })}`;
}
