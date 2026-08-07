import { BANGKOK_OFFSET_MS, DAY_MS } from '../../common/time/bangkok';

/**
 * Which group a meeting falls into (US-MTG-01). DERIVED, never stored: a stored
 * bucket is wrong from the moment the Bangkok day turns, and would need a
 * nightly job to stay honest. The catalogue lists `meetings.bucket` as a
 * column; this is the same decision taken for invoice ageing and session
 * colour — compute what changes with the clock.
 */
export const MEETING_BUCKETS = ['today', 'upcoming', 'past'] as const;
export type MeetingBucket = (typeof MEETING_BUCKETS)[number];

export type MeetingMode = 'Video' | 'In person' | 'Phone';

/** A `date` column arrives as `YYYY-MM-DD`; a `time` as `HH:MM[:SS]`. */
export function bucketFor(meetingDate: string, now: Date): MeetingBucket {
  const day = bangkokDayOf(meetingDate);
  const today = bangkokDayNow(now);
  if (day === today) return 'today';
  return day > today ? 'upcoming' : 'past';
}

/**
 * The UTC instant a meeting starts. The date and time are stored as BANGKOK
 * wall clock — that is what an organizer typed and what the venue expects — so
 * the offset is applied here rather than pretending the stored values are UTC.
 */
export function startsAt(meetingDate: string, startTime: string): Date {
  const [hours, minutes] = startTime.split(':').map(Number);
  const midnight = bangkokDayOf(meetingDate) * DAY_MS - BANGKOK_OFFSET_MS;
  return new Date(midnight + hours * 60 * 60 * 1000 + minutes * 60 * 1000);
}

/**
 * Whether to offer Join (US-MTG-07). Video only, never in the past, and only
 * once the calendar sync has actually produced a link — a Join button that
 * goes nowhere is worse than none, so an unsynced meeting shows the hint
 * instead.
 */
export function isJoinable(
  meeting: { mode: MeetingMode; link: string | null; date: string },
  now: Date,
): boolean {
  if (meeting.mode !== 'Video' || !meeting.link) return false;
  return bucketFor(meeting.date, now) !== 'past';
}

/** Days since the epoch for a `YYYY-MM-DD` read as a Bangkok calendar day. */
function bangkokDayOf(meetingDate: string): number {
  return Math.floor(Date.parse(`${meetingDate}T00:00:00Z`) / DAY_MS);
}

/** The Bangkok calendar day `now` falls on. */
function bangkokDayNow(now: Date): number {
  return Math.floor((now.getTime() + BANGKOK_OFFSET_MS) / DAY_MS);
}
