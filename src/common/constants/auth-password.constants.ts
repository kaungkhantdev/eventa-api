/** The auth-password module's named constants. */

export const WRONG_CURRENT = 'Your current password is incorrect.';

export const REUSED =
  'Please choose a password different from your current one.';

export const CHANGED = 'Your password has been changed.';

/** An active account with no password and no provider left linked to it. */
export const NO_PASSWORD_NO_PROVIDER =
  'That account has no password to reset — it signs in through a social provider. Use that sign-in instead.';

/**
 * The same words however many links went out. Counting them would tell an
 * anonymous caller how many workspaces the address belongs to — which sign-in
 * reveals only after the password checks out. Each email names its own.
 */
export const LINK_ON_ITS_WAY = 'A password-reset link is on its way.';

/**
 * How many accounts on one address a single request looks at. Each usable one
 * gets its own email, so this bounds what an anonymous caller can make the form
 * send — the same bound sign-in puts on the accounts it checks.
 */
export const MAX_RESET_ACCOUNTS = 10;

export const RESET_DONE = 'Your password has been reset. Please sign in.';

export const INVALID_LINK =
  'This reset link is invalid or has expired. Request a new one.';

export const REUSED_PASSWORD =
  'Please choose a password different from your current one.';

/**
 * The single password-strength standard, applied everywhere a password is set —
 * sign-up, reset, change and accepting an invite (US-ACC-01 note). Keep the
 * rule here so every surface enforces exactly the same minimum.
 *
 * US-SET-02 defines it: "at least 8 characters with a number and a symbol".
 * eventa-web's `passwordStrength.ts` mirrors it for the meter; change both
 * together.
 */
export const PASSWORD_MIN_LENGTH = 8;

export const PASSWORD_MAX_LENGTH = 128;

/**
 * At least one digit and one symbol. A symbol is anything that is not a letter,
 * a combining mark or a number — punctuation, a space — so a Thai letter or
 * vowel sign never passes for one. No letter is required.
 */
export const PASSWORD_PATTERN = /^(?=.*\d)(?=.*[^\p{L}\p{M}\p{N}]).+$/u;

/** Built from the constant — a hard-coded number here once outlived the rule. */
export const PASSWORD_RULE_MESSAGE = `Password must be at least ${PASSWORD_MIN_LENGTH} characters and include a number and a symbol.`;

/** Routing key for the "your password was changed" notice (consumed by the worker). */
export const IDENTITY_PASSWORD_CHANGED = 'identity.password_changed';

/** Routing key for a password-reset email (consumed by eventa-worker). */
export const IDENTITY_PASSWORD_RESET_REQUESTED =
  'identity.password_reset_requested';
