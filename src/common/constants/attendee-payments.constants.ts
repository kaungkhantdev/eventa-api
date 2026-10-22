/** The attendee-payments module's named constants. */

/** An export is one person's purchases — bounded, but capped for sanity. */
export const MAX_EXPORT = 1000;

export const DEFAULT_VAT_RATE = 0.07;

export const DEFAULT_LIMIT = 20;

export const MAX_LIMIT = 100;

export const FIRST_PAGE = 1;

export const SATANG_PER_BAHT = 100;

export const CSV_HEADER =
  'date,reference,event,method,status,amount_baht,vat_baht';

/** The VAT receipt SVG's canvas. */
export const RECEIPT_WIDTH = 600;

export const RECEIPT_HEIGHT = 760;

/** Where the receipt's text starts, and where right-aligned text ends. */
export const RECEIPT_LEFT_X = 60;

export const RECEIPT_RIGHT_X = RECEIPT_WIDTH - 60;

export const PERCENT = 100;
