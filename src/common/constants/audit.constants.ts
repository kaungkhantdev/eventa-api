import { auditTypeEnum } from '../../db/schema/index';

/** The audit module's named constants. */

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

export const DEFAULT_LIMIT = 50;

export const MAX_LIMIT = 200;

/** Anything that looks like a secret is shown as a hint, never in full. */
export const SECRET_HINT = /((?:sk|pk|rk)_[A-Za-z0-9_]+|[A-Za-z0-9]{24,})/g;

/** The act labels, read off the schema enum — never a re-typed list. */
export const TYPES = auditTypeEnum.enumValues;

export const SUBJECT_PAIR =
  'Send subjectType and subjectId together — half a subject matches nothing in particular.';
