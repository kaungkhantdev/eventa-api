import { DomainException } from '../../common/errors/domain.exception';
import type { announcementStatusEnum } from '../../db/schema';
import {
  ALREADY_CANCELLED,
  ALREADY_SENT,
  CHANGED_MEANWHILE,
  MAX_SCHEDULE_AHEAD_MS,
  MIN_SCHEDULE_LEAD_MS,
  TOO_FAR,
  TOO_SOON,
} from '../../common/constants/announcements.constants';

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
