import type { eventStatusEnum } from '../../db/schema';
import {
  CHECKIN_GRACE_AFTER_END_MS,
  CHECKIN_OPENS_BEFORE_START_MS,
} from '../../common/constants/check-in.constants';

type EventStatus = (typeof eventStatusEnum.enumValues)[number];

/** The slice of an event the door needs to decide whether it is admitting. */
export interface CheckInWindowEvent {
  status: EventStatus;
  startAt: Date;
  endAt: Date | null;
}

/** Only an event that is actually happening can admit anyone. */
const ADMITTING_STATUSES: readonly EventStatus[] = [
  'planned',
  'upcoming',
  'live',
];

/**
 * Whether the door is open (US-REG-11/12). Derived from the event's own times
 * rather than stored, so there is no per-event window to keep in step — add
 * columns only if an organizer needs to override it.
 *
 * An event with no `endAt` measures the grace from its START; a single-session
 * event usually has no end time, and without this it would become
 * un-checkinable the moment it began.
 */
export function isCheckInOpen(event: CheckInWindowEvent, now: Date): boolean {
  if (!ADMITTING_STATUSES.includes(event.status)) return false;
  const opensAt = event.startAt.getTime() - CHECKIN_OPENS_BEFORE_START_MS;
  const closesAt =
    (event.endAt ?? event.startAt).getTime() + CHECKIN_GRACE_AFTER_END_MS;
  const at = now.getTime();
  return at >= opensAt && at <= closesAt;
}
