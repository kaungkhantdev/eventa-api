import {
  CONTACT_AUDIT_TYPE,
  contactAuditSubject,
} from '../attendee-directory/attendee-contact.audit';
import type { auditTypeEnum } from '../../db/schema';

/** An `audit_type` label — derived from the schema enum, not re-typed. */
export type AuditType = (typeof auditTypeEnum.enumValues)[number];

/**
 * The record kinds a trail entry can be asked about.
 *
 * One member today, because exactly one writer encodes a machine-readable
 * subject: `attendee-contact.audit.ts`. The other five writers of
 * `audit_events` (auth, check-in, invoices, payouts, and this module's own
 * export entry) put their subject in the `title` as prose —
 * `Undid check-in for ticket <id>`, `Retried payout <reference>` — which is not
 * a format anything may filter on. Adding a member here is a compile error
 * until `RESOLVERS` learns it.
 */
export const AUDIT_SUBJECT_TYPES = ['attendee'] as const;

export type AuditSubjectType = (typeof AUDIT_SUBJECT_TYPES)[number];

/** Which record the caller is asking about. */
export interface AuditSubject {
  type: AuditSubjectType;
  id: number;
}

/** How that question is answered in SQL: a type, and a `meta` prefix. */
export interface AuditSubjectFilter {
  auditType: AuditType;
  metaPrefix: string;
}

/**
 * **This is a string-prefix match, and it is worth saying so plainly.**
 *
 * `audit_events` has no subject columns. A contact edit records which record it
 * was about by beginning `meta` with `attendee #42 ·`, so "what happened to
 * attendee 42" is `type = 'attendee' AND meta LIKE 'attendee #42 ·%'` — a
 * free-text prefix, not a structured reference. Nothing in the database
 * enforces the format, and the trail is append-only and never deleted, so a
 * writer that changed the prefix would orphan every historical row with no
 * error anywhere.
 *
 * What makes that survivable is that the prefix is imported from the writer
 * that produces it rather than copied here: a rename breaks this call site at
 * compile time instead of silently emptying the timeline. `contactAuditSubject`
 * is exported for exactly this ("so that story reads the format from here
 * rather than re-deriving it"), and it is a pure format function — no table, no
 * repository, no provider — so reading it adds no coupling to the attendee
 * module's internals.
 *
 * The type is pinned alongside the prefix, as that writer's docstring
 * specifies. It narrows the scan to `ix_audit_events_type` and it means a
 * different writer's free text that happened to start with the same characters
 * could not be mistaken for an attendee's history.
 *
 * **Why `audit_events` does not get `subject_type` / `subject_id` here.** Real
 * columns are the right destination and this is deliberately not the change
 * that adds them. Six modules insert into `audit_events`, and five of them put
 * their subject in the `title` as prose; only the attendee writer encodes one
 * at all. Columns added now would be NULL for every one of those five, and —
 * because the write side lives in modules this change does not own — NULL for
 * new attendee rows too until each writer learned them. A reader keyed on an
 * unpopulated column returns nothing and reports no error, which is strictly
 * worse than a prefix match that works. The migration and the writers have to
 * land together.
 *
 * What forces it: a second subject kind (a ticket's or an invoice's trail,
 * which would need its own prose parser), a subject whose key is free text
 * rather than an integer (wildcards to escape, no safe prefix), a timeline that
 * has to span types for one record (`LIKE` per type does not compose), or this
 * table growing past the point where a non-indexable `meta` scan is affordable.
 * Any of those, and the move is: add the columns nullable, teach every writer,
 * backfill the `attendee` rows by regex off this same prefix (deterministic
 * precisely because a machine wrote them), then read columns instead of text.
 */
const RESOLVERS: {
  readonly [K in AuditSubjectType]: (id: number) => AuditSubjectFilter;
} = {
  attendee: (id) => ({
    auditType: CONTACT_AUDIT_TYPE,
    metaPrefix: contactAuditSubject(id),
  }),
};

export function toSubjectFilter(subject: AuditSubject): AuditSubjectFilter {
  return RESOLVERS[subject.type](subject.id);
}
