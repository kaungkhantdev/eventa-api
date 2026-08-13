import type { meetings } from '../../db/schema';
import type { MeetingBucket, MeetingMode } from './meeting-bucket';

/** The row as stored — never exposed at the edge; map it first. */
export type MeetingRow = typeof meetings.$inferSelect;

export type MeetingType = MeetingRow['type'];

export interface NewMeeting {
  title: string;
  meetingDate: string;
  startTime: string;
  endTime: string;
  type: MeetingType;
  mode: MeetingMode;
  person: string;
  role: string | null;
  guestEmail: string;
  eventId: string | null;
  location: string | null;
  notes: string | null;
  idempotencyKey: string;
  createdBy: string;
}

/** The fields a reschedule may move. Status and sync state are not among them. */
export type MeetingPatch = Partial<
  Pick<
    NewMeeting,
    | 'title'
    | 'meetingDate'
    | 'startTime'
    | 'endTime'
    | 'type'
    | 'mode'
    | 'person'
    | 'role'
    | 'guestEmail'
    | 'eventId'
    | 'location'
    | 'notes'
  >
> & {
  /** Cleared when a video meeting becomes in-person (US-MTG-05). */
  link?: string | null;
};

export interface MeetingFilters {
  page: number;
  limit: number;
  bucket?: MeetingBucket;
  type?: MeetingType;
  eventId?: string;
  search?: string;
  /** Events whose name matched the search, resolved by Events beforehand. */
  eventIds?: string[];
}

export interface MeetingCounts {
  all: number;
  today: number;
  upcoming: number;
  past: number;
}
