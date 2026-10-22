/** The discounts module's named constants. */

/** Words that read as a promotion and survive being typed off a poster. */
export const WORDS = [
  'PROMO',
  'SAVE',
  'EARLY',
  'BONUS',
  'TREAT',
  'FRIEND',
  'WELCOME',
  'THANKS',
  'CHEER',
  'BOOST',
  'SPARK',
  'LUCKY',
] as const;

export const MIN_SUFFIX = 10;

export const MAX_SUFFIX = 100; // exclusive → always two digits

/** After this many collisions, widen the suffix rather than spin forever. */
export const ATTEMPTS_BEFORE_WIDENING = 40;

export const WIDE_SUFFIX_MAX = 100_000;

export const PERCENT_DIVISOR = 100;

export const SATANG_PER_BAHT = 100;

export const DEFAULT_LIMIT = 20;

export const MAX_LIMIT = 100;

export const ALL_EVENTS_LABEL = 'All events';

/** Readable off a poster and typed without ambiguity. */
export const CODE_PATTERN = /^[A-Z0-9-]+$/;

export const CODE_MIN = 3;

export const CODE_MAX = 24;

export const PERCENT_MIN = 1;

export const PERCENT_MAX = 100;

export const MIN_FIXED_SATANG = 1;

/** A 0 limit means unlimited — for the total, per person, and the minimum order. */
export const UNLIMITED = 0;

export const DEFAULT_VAT_RATE = 0.07;

export const MAX_SEARCH = 120;

/** A redemption limit of 0 means unlimited — mirrors `DiscountsPolicy`. */
export const UNLIMITED_REDEMPTIONS = 0;

export const REDEMPTION_LIMIT_REACHED =
  'This code has reached its redemption limit.';
