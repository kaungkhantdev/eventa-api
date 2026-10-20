/** The auth module's named constants. */

export const BEARER = 'Bearer';

/**
 * How many accounts on one address are checked before sign-in asks which
 * workspace instead. Each one costs an argon2 verification, which is expensive
 * on purpose, so the work an anonymous caller can provoke stays bounded.
 */
export const MAX_LOGIN_CANDIDATES = 10;

/** Routing key for the sign-in event (consumed by eventa-worker). */
export const IDENTITY_SIGNED_IN = 'identity.signed_in';

export const SECONDS_PER_MINUTE = 60;

/** Workspace invites are valid for 7 days. */
export const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;

/** An email-confirmation link is valid for 24 hours. */
export const EMAIL_VERIFICATION_TTL_SECONDS = 24 * 60 * 60;

/** An email-change confirmation link is valid for 24 hours. */
export const EMAIL_CHANGE_TTL_SECONDS = 24 * 60 * 60;

/** A password-reset link is valid for 1 hour. */
export const PASSWORD_RESET_TTL_SECONDS = 60 * 60;

/** The window between a correct password and its 2FA code (US-ACC-05). */
export const TWO_FACTOR_CHALLENGE_TTL_SECONDS = 5 * 60;

/** A booking's create-your-account link is valid for 7 days (US-DISC-15). */
export const BOOKING_CLAIM_TTL_SECONDS = 7 * 24 * 60 * 60;

export const BOOKING_CLAIM_TYPE = 'booking_claim';
