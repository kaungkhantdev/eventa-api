/** The auth-two-factor module's named constants. */

/** The story's number: eight one-time codes, shown once. */
export const RECOVERY_CODE_COUNT = 8;

export const RECOVERY_CODE_BYTES = 5; // → 10 hex chars, formatted as XXXXX-XXXXX

export const ISSUER = 'Eventa';

/** A recovery code is longer than a TOTP; both arrive through `code`. */
export const MIN_CODE = 6;

export const MAX_CODE = 32;

/** Routing key for the "two-factor was turned off" notice (consumed by the worker). */
export const IDENTITY_TWO_FACTOR_DISABLED = 'identity.two_factor_disabled';

export const BEARER = 'Bearer';

export const EXPIRED_MESSAGE =
  'Your sign-in challenge expired — please sign in again.';

export const BAD_CODE_MESSAGE =
  "That code didn't work. Try the next one, or a recovery code.";
