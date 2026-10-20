/** The ticketing module's named constants. */

export const MAX_LIMIT = 100;

export const MAX_SEARCH = 120;

/**
 * A tier is "selling fast" once this percentage of its allocation is gone.
 * Named here, in Ticketing, because Ticketing owns what running low means — the
 * dashboard only renders the count it is given (US-DASH-06/11).
 */
export const LOW_STOCK_PERCENT = 80;

export const FULL = 100;

/** An allocation of 0 means unlimited — mirrors `TicketingPolicy`. */
export const UNLIMITED = 0;

export const ON_SALE = 'onsale';

export const DEFAULT_LIMIT = 20;

/** The seating mode whose seat map can set the quantities (US-EVT-05). */
export const RESERVED = 'reserved';

export const DEFAULT_VAT_RATE = 0.07;

export const WAITLIST_OFFER_FAILED =
  'Raised a ticket allocation, but offering the new places to its waitlist failed';
