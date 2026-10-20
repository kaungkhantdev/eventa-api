/** The attendee-directory module's named constants. */

/**
 * How a corrected attendee contact is written to the audit trail (US-REG-08).
 *
 * There is ONE mechanism here, not two. The story asks for the change to be
 * "recorded for audit" (AC1) and for an "Updated contact details" entry on the
 * profile's activity timeline (AC5), and in this codebase both are
 * `audit_events`: it is the only durable record of an act that no other table
 * remembers, and it is deliberately hard to erase (its `organizations`
 * reference is the schema's single `ON DELETE RESTRICT`). A second activity
 * table would be a parallel trail that could disagree with the first.
 *
 * The title is the story's own phrase, verbatim and unparameterised, so the
 * timeline entry and the workspace audit line read the same sentence and no
 * client has to match on prose that will be translated.
 */
export const CONTACT_AUDIT_TYPE = 'attendee' as const;

export const CONTACT_AUDIT_TITLE = 'Updated contact details';

export const NOT_FOUND = 'That attendee is not in this workspace.';

export const NOTHING_TO_CHANGE =
  'Send a name, email or phone number to change.';

export const BLANK_NAME = 'Enter the attendee’s name.';

export const MOVED_ELSEWHERE =
  'This attendee changed while you had the form open. Reload and try again.';

/**
 * The merge prompt (AC3).
 *
 * Deliberately free of the other record's address and name. A 4xx `message` is
 * logged as a warning by the global exception filter, so naming the person here
 * would write somebody's email into the application log on every collision —
 * and the console does not need it: it already holds the address the organizer
 * typed, and `GET /attendees?search=<address>` returns the record that owns it.
 */
export const EMAIL_IN_USE =
  'That email address already belongs to another attendee in this workspace. ' +
  'Merge the two records instead of overwriting — a second record on the same ' +
  'address would split one person’s registrations in two. Search the directory ' +
  'for the address to open the record that holds it.';

/**
 * The same refusal where the holder was removed. "Merge the two" is the wrong
 * instruction for a record nobody can open, so the remedy named is different.
 */
export const EMAIL_IN_USE_BY_REMOVED =
  'That email address is still held by an attendee record that was removed ' +
  'from this workspace, so it cannot be reused yet. Merge the two records ' +
  'rather than taking the address, or the removed record’s history will be ' +
  'attached to this person.';

/** An attendee is "new" if this workspace first saw them within 30 days. */
export const NEW_WINDOW_DAYS = 30;

/** The three fields an organizer may correct, in the order they are reported. */
export const CONTACT_FIELDS = ['name', 'email', 'phone'] as const;

export const DEFAULT_LIMIT = 25;

export const MAX_LIMIT = 100;

export const MAX_SEARCH = 120;

// The same limits the walk-up booking form uses (`AddRegistrationDto`), which
// are the ones `attendees` is documented with: a name is 1–120 characters.
export const MAX_NAME = 120;

export const MAX_EMAIL = 254;

export const MAX_PHONE = 24;
