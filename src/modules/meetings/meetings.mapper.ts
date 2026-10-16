import { bucketFor, isJoinable, startsAt } from './meeting-bucket';
import { PHONE_LOCATION } from './meeting-schedule';
import type { MeetingRow } from './meetings.types';
import type { MeetingEntryDto } from './dto/meetings.dto';

/** How a today meeting reads its time, per US-MTG-01's "Today · 09:00 – 10:00". */
const TODAY_PREFIX = 'Today';

/**
 * Row → what the list shows. Three things are DERIVED here rather than stored,
 * because each of them changes with the clock or with the mode and a stored
 * copy would go quietly stale: which tab the meeting belongs in, whether Join
 * should be offered, and the human time label.
 */
export function toMeetingEntry(
  row: MeetingRow,
  eventName: string | null,
  now: Date,
): MeetingEntryDto {
  const bucket = bucketFor(row.meetingDate, now);
  return {
    id: row.id,
    title: row.title,
    date: row.meetingDate,
    startTime: trimSeconds(row.startTime),
    endTime: trimSeconds(row.endTime),
    startsAt: startsAt(row.meetingDate, row.startTime).toISOString(),
    timeLabel: timeLabel(row, bucket),
    bucket,
    isToday: bucket === 'today',
    type: row.type,
    mode: row.mode,
    status: row.status,
    person: row.person,
    role: row.role,
    guestEmail: row.guestEmail,
    eventId: row.eventId,
    eventName,
    place: placeOf(row),
    link: row.link,
    notes: row.notes,
    syncStatus: row.syncStatus,
    // Never for a cancelled meeting: there is nothing to join (US-MTG-06).
    canJoin:
      row.status === 'scheduled' &&
      isJoinable(
        { mode: row.mode, link: row.link, date: row.meetingDate },
        now,
      ),
    canEdit: row.status === 'scheduled',
    cancellationReason: row.cancellationReason,
    version: row.version,
  };
}

/**
 * Where it happens, by mode (US-MTG-03): the link for video, "Phone call" for
 * phone, and the event's venue in person — null when there is no venue, which
 * is not the same as being on the phone.
 */
function placeOf(row: MeetingRow): string | null {
  if (row.mode === 'Video') return row.link;
  if (row.mode === 'Phone') return PHONE_LOCATION;
  return row.location;
}

function timeLabel(row: MeetingRow, bucket: string): string {
  const span = `${trimSeconds(row.startTime)} – ${trimSeconds(row.endTime)}`;
  return bucket === 'today' ? `${TODAY_PREFIX} · ${span}` : span;
}

/** Postgres returns `time` as `HH:MM:SS`; the console shows `HH:MM`. */
function trimSeconds(time: string): string {
  return time.slice(0, 5);
}
