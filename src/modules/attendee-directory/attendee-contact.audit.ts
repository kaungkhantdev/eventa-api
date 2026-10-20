import type { ContactField } from './attendee-directory.types';

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
