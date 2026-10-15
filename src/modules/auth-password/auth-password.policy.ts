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
