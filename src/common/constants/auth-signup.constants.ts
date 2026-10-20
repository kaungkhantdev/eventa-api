/** The auth-signup module's named constants. */

export const ADMIN_PERSONA = 'admin';

export const ATTENDEE_PERSONA = 'attendee';

/**
 * Signed up, email not yet proven — NOT `Invited`. Nobody invited someone who
 * filled in the sign-up form themselves, and an organizer reading the members
 * list should not be told otherwise.
 */
export const PENDING_STATUS = 'Unconfirmed';

export const ACTIVE_STATUS = 'Active';

export const CHECK_INBOX_MESSAGE =
  'Check your inbox to confirm your email and finish signing up.';

export const INVALID_LINK_MESSAGE =
  'This confirmation link is invalid or has expired. Request a new one.';

export const NO_ATTENDEE_WORKSPACE_MESSAGE =
  "An attendee account doesn't have a workspace — leave organizationName out.";

export const NAME_TAKEN_MESSAGE =
  'That workspace name is already taken. Try another.';

/** Routing key for a new account's email-confirmation (consumed by eventa-worker). */
export const IDENTITY_EMAIL_VERIFICATION_REQUESTED =
  'identity.email_verification_requested';
