import type { ContactField } from './attendee-directory.types';

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

/**
 * The record an entry is about, written so a prefix match is unambiguous: the
 * trailing separator is what keeps `attendee #4 ·` from matching `attendee #42`.
 */
const SUBJECT = (attendeeId: number): string => `attendee #${attendeeId} ·`;

/**
 * The entry's `meta`: which record, and which fields moved — **never the
 * values**.
 *
 * `audit_events` cannot be erased on request, so an address or a name written
 * here would outlive the attendee's right to have it removed. The field names
 * carry everything an auditor needs and nothing a subject could ask back.
 */
export function contactAuditMeta(
  attendeeId: number,
  fields: readonly ContactField[],
): string {
  return `${SUBJECT(attendeeId)} changed: ${fields.join(', ')}`;
}

/**
 * The `meta` prefix the attendee profile's activity timeline (US-REG-05, not
 * yet built) will filter on, alongside `type = 'attendee'`. Exported so that
 * story reads the format from here rather than re-deriving it.
 */
export function contactAuditSubject(attendeeId: number): string {
  return SUBJECT(attendeeId);
}
