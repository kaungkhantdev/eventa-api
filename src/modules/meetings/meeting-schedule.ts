import { DomainException } from '../../common/errors/domain.exception';
import { BANGKOK_OFFSET_MS, DAY_MS } from '../../common/time/bangkok';
import type { MeetingMode } from './meeting-bucket';

/** Short enough for "Sync", long enough to rule out a stray keystroke. */
export const MIN_TITLE = 3;
/** What a phone meeting shows where a venue would be (US-MTG-03). */
export const PHONE_LOCATION = 'Phone call';

export const TITLE_REQUIRED = `Give the meeting a title of at least ${MIN_TITLE} characters.`;
export const DATE_PAST =
  'That date has already passed — choose today or later.';
export const END_BEFORE_START = 'The end time must be after the start time.';

export interface SchedulableMeeting {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  mode: MeetingMode;
}

/**
 * Everything that must hold before a meeting is written (US-MTG-03). Pure and
 * stateless, so it decides on the values handed to it and the service stays
 * orchestration — and so each rule has a test naming the mistake it catches.
 *
 * "Past" is judged on the BANGKOK calendar day. A UTC comparison is wrong for
 * seven hours out of every twenty-four: between 17:00 and 24:00 UTC it is
 * already tomorrow in Bangkok, and an organizer booking "today" would be told
 * their own working day had passed.
 */
export function assertSchedulable(
  meeting: SchedulableMeeting,
  now: Date,
): void {
  if (meeting.title.trim().length < MIN_TITLE) {
    throw DomainException.validation(TITLE_REQUIRED);
  }
  if (bangkokDayOf(meeting.date) < bangkokDayNow(now)) {
    throw DomainException.validation(DATE_PAST);
  }
  if (minutesOf(meeting.endTime) <= minutesOf(meeting.startTime)) {
    throw DomainException.validation(END_BEFORE_START);
  }
}

export interface MeetingPlace {
  /** Null for video: the link is the place. */
  location: string | null;
  /** True when the calendar sync must mint a Meet link for this meeting. */
  needsLink: boolean;
}

/**
 * Where the meeting happens, decided by its MODE rather than by anything the
 * organizer types (US-MTG-03/05). This is also what makes changing the mode
 * safe: switching to In person yields `needsLink: false`, and the caller drops
 * the Meet link — a stale join link on an in-person meeting would send the
 * guest to an empty call instead of the venue.
 */
export function placeOf(
  mode: MeetingMode,
  eventVenue: string | null,
): MeetingPlace {
  if (mode === 'Video') return { location: null, needsLink: true };
  if (mode === 'Phone') return { location: PHONE_LOCATION, needsLink: false };
  return { location: eventVenue, needsLink: false };
}

/** Minutes since midnight — so 09:00 and 10:00 compare as clock times. */
function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function bangkokDayOf(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

function bangkokDayNow(now: Date): number {
  return Math.floor((now.getTime() + BANGKOK_OFFSET_MS) / DAY_MS);
}
