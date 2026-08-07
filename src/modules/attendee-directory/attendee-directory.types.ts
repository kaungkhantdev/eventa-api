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
