import { ne, sql } from 'drizzle-orm';
import { meetings } from '../../db/schema/index';

/** The meetings module's named constants. */

export const MAX_TITLE = 200;

export const MAX_PERSON = 120;

export const MAX_ROLE = 120;

export const MAX_EMAIL = 254;

export const MAX_NOTES = 2000;

export const MAX_REASON = 500;

/** `HH:MM`, 24-hour — the wall clock an organizer types. */
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const TIME_MESSAGE = 'Use a 24-hour time like 09:30.';

/**
 * One contract, three intents. The worker's calendar handler needs to create,
 * update or withdraw the same invite, and routing them separately would let a
 * `cancelled` overtake the `rescheduled` it supersedes — the outbox preserves
 * order per aggregate, and only within one routing key.
 */
export const MEETING_SYNC_REQUESTED = 'meeting.sync_requested';

/** The groups a meeting is listed under (US-MTG-01), derived by `bucketFor`. */
export const MEETING_BUCKETS = ['today', 'upcoming', 'past'] as const;

/** Short enough for "Sync", long enough to rule out a stray keystroke. */
export const MIN_TITLE = 3;

/** What a phone meeting shows where a venue would be (US-MTG-03). */
export const PHONE_LOCATION = 'Phone call';

export const TITLE_REQUIRED = `Give the meeting a title of at least ${MIN_TITLE} characters.`;

export const DATE_PAST =
  'That date has already passed — choose today or later.';

export const END_BEFORE_START = 'The end time must be after the start time.';

export const DEFAULT_LIMIT = 20;

export const MAX_LIMIT = 100;

export const NO_MATCHES = 'No meetings match your filters.';

/** How a today meeting reads its time, per US-MTG-01's "Today · 09:00 – 10:00". */
export const TODAY_PREFIX = 'Today';

/** Today in BANGKOK, decided by the database so every row is judged alike. */
export const TODAY = sql`(now() AT TIME ZONE 'Asia/Bangkok')::date`;

/**
 * A cancelled meeting no longer counts toward Today or Upcoming (US-MTG-06).
 * It stays on record under All, and under Past once its date has gone by.
 */
export const NOT_CANCELLED = ne(meetings.status, 'cancelled');

export const GONE = "That meeting isn't available.";

export const ALREADY_CANCELLED =
  'This meeting was cancelled and can no longer be edited.';

export const CHANGED_UNDERNEATH =
  'Someone else changed this meeting — reload it and try again.';

export const NO_SUCH_EVENT = "That event isn't in this workspace.";
