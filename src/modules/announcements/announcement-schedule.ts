import { DomainException } from '../../common/errors/domain.exception';
import type { announcementStatusEnum } from '../../db/schema';

/**
 * The rules for sending an announcement later, and for changing one that has
 * not gone yet (US-MSG-04/05). Pure, so every limit here is a unit test away.
 */

export type AnnouncementStatus =
  (typeof announcementStatusEnum.enumValues)[number];

/** The one state an organizer can still change. */
export const SCHEDULED: AnnouncementStatus = 'scheduled';
export const SENT: AnnouncementStatus = 'sent';
export const CANCELLED: AnnouncementStatus = 'cancelled';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * The shortest lead a scheduled send may have.
 *
 * Scheduling exists so an organizer can change their mind (US-MSG-05); a send
 * a minute out gives them no time to, and is a send-now in all but name. Five
 * minutes also sits well clear of the worker's once-a-minute sweep.
 */
export const MIN_SCHEDULE_LEAD_MS = 5 * MINUTE_MS;

/**
 * The furthest ahead one may be scheduled. A year covers any real event's
 * run-up; anything beyond it is almost certainly a mistyped year, and a
 * forgotten broadcast going out thirteen months later is worse than a refusal.
 */
export const MAX_SCHEDULE_AHEAD_MS = 365 * DAY_MS;

export const TOO_SOON =
  'Pick a send time at least 5 minutes from now, so there is still time to change it.';
export const TOO_FAR =
  'Pick a send time within the next year — anything later is probably a typo.';

export const ALREADY_SENT =
  'This announcement has already started sending and can no longer be changed.';
export const ALREADY_CANCELLED =
  'This announcement was cancelled and can no longer be changed.';
/**
 * Totality, not a path anyone is expected to hit: a change that finds the row
 * still scheduled goes through, because Postgres re-checks the condition after
 * waiting for a concurrent writer.
 */
export const CHANGED_MEANWHILE =
  'This announcement changed while you were looking at it. Reload to see where it stands.';

/** Where a send time must fall. `sendAt` and `now` are both instants (UTC). */
export function assertSchedulable(sendAt: Date, now: Date): void {
  const lead = sendAt.getTime() - now.getTime();
  if (lead < MIN_SCHEDULE_LEAD_MS) {
    throw DomainException.invalidField('sendAt', TOO_SOON);
  }
  if (lead > MAX_SCHEDULE_AHEAD_MS) {
    throw DomainException.invalidField('sendAt', TOO_FAR);
  }
}

const WHY_UNCHANGEABLE: Record<AnnouncementStatus, string> = {
  sent: ALREADY_SENT,
  cancelled: ALREADY_CANCELLED,
  scheduled: CHANGED_MEANWHILE,
};

/**
 * The refusal for changing an announcement that is no longer scheduled. A
 * conflict, written for the organizer: the web shows it verbatim.
 */
export function unchangeableBecause(
  status: AnnouncementStatus,
): DomainException {
  return DomainException.conflict(WHY_UNCHANGEABLE[status]);
}

/**
 * A send time on the wire: an ISO-8601 instant that states its zone.
 *
 * `2026-08-05T10:00` with no zone would be read in the SERVER's timezone and
 * move the send by however far that is from Bangkok. UTC on the wire means the
 * caller says so.
 */
export const INSTANT_WITH_ZONE = /(Z|[+-]\d{2}:\d{2})$/;
export const INSTANT_WITH_ZONE_MESSAGE =
  'sendAt must be an ISO-8601 instant with a timezone, e.g. 2026-08-05T03:00:00.000Z.';
