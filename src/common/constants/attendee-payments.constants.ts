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

export const WIDTH = 600;

export const HEIGHT = 760;

export const LEFT = 60;

export const RIGHT = WIDTH - 60;

export const PERCENT = 100;
