/**
 * What "Delete my account" (US-DISC-14) tells the attendee. The web shows each
 * message verbatim, so a change here is a change on screen.
 */

export const NOT_AN_ATTENDEE =
  'Only attendee accounts can be deleted here — workspace members are managed by their organization.';
export const WRONG_PASSWORD =
  "That password didn't match — your account is unchanged.";
export const NO_PASSWORD_SET =
  'Your account signs in with a social provider. Please set a password first (via password reset) to re-verify your identity.';
export const CODE_REQUIRED =
  'Your authenticator code is required to delete this account.';
export const WRONG_CODE = "That code didn't match — your account is unchanged.";
export const ACCOUNT_GONE =
  'Your session is no longer valid. Please sign in again.';
export const SCHEDULED =
  'Your account is scheduled for deletion and you have been signed out everywhere. A confirmation email is on its way.';

/** Only a confirmed AND settled order is money the deleter forfeits. */
export const CONFIRMED = 'confirmed';

export const PAID = 'paid';

/** The exact phrase the danger zone makes the user type — no accidental clicks. */
export const DELETE_CONFIRMATION = 'DELETE';

/** A recovery code is longer than a TOTP; both arrive through `code`. */
export const MIN_CODE = 6;

export const MAX_CODE = 32;

/**
 * Routing key for a confirmed account deletion (consumed by eventa-worker).
 * The worker sends the confirmation email. It does NOT anonymize the personal
 * data: that PDPA scrub is unbuilt on both sides, so the soft-deleted row
 * still holds the email. The address is free for a new sign-up anyway,
 * because `uq_users_org_email_persona` only covers live rows.
 */
export const IDENTITY_ACCOUNT_DELETION_REQUESTED =
  'identity.account_deletion_requested';
