import type { attendeeTagEnum } from '../../db/schema';

export type AttendeeTag = (typeof attendeeTagEnum.enumValues)[number];

/** The segments the directory offers (US-REG-05). */
export type Segment = 'all' | 'new' | 'checked_in' | 'vip';

/** How the directory is ordered. Ties always break on recent activity. */
export type SortBy = 'recent' | 'name' | 'events' | 'tickets';

export interface AttendeeRow {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  tag: AttendeeTag | null;
  firstSeenAt: Date;
  /** Most recent registration — what "recent activity" sorts on. */
  lastActivityAt: Date | null;
  eventCount: number;
  ticketCount: number;
  checkedInCount: number;
}

export interface DirectoryFilters {
  page: number;
  limit: number;
  segment?: Segment;
  tag?: AttendeeTag;
  search?: string;
  sort?: SortBy;
}

export interface SegmentCounts {
  all: number;
  new: number;
  checkedIn: number;
  vip: number;
}

// ── Keeping contact details current (US-REG-08) ──────────────────────────────

/** The three fields an organizer may correct, in the order they are reported. */
export const CONTACT_FIELDS = ['name', 'email', 'phone'] as const;

export type ContactField = (typeof CONTACT_FIELDS)[number];

/** Just enough of the row to decide what is changing and guard the write. */
export interface AttendeeContactRow {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  /** The optimistic-concurrency token the UPDATE is guarded by. */
  version: number;
}

/** The values a save is actually moving — absent keys are left alone. */
export interface ContactChanges {
  name?: string;
  email?: string;
  /** Null clears it: the organizer emptied the field. */
  phone?: string | null;
}

/**
 * Who already owns an address, soft-deleted records included — because
 * `uq_attendees_org_email` includes them.
 */
export interface EmailHolder {
  id: number;
  /** The holder is soft-deleted, so "merge the two" is the wrong instruction. */
  removed: boolean;
}

export interface SaveContactInput {
  changes: ContactChanges;
  /** Which fields moved — the audit entry names them, never their values. */
  fields: readonly ContactField[];
  /** The version read moments ago, never the caller's word for it. */
  expectedVersion: number;
  actorUserId: string;
  now: Date;
}
