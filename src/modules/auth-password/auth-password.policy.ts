/**
 * The single password-strength standard, applied everywhere a password is set —
 * sign-up, reset and change (US-ACC-01 note). Keep the rule here so all three
 * surfaces enforce exactly the same minimum.
 */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/** At least one letter and one digit (a pragmatic minimum, not a max-strength gate). */
export const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).+$/;

export const PASSWORD_RULE_MESSAGE =
  'Password must be at least 10 characters and include a letter and a number.';
