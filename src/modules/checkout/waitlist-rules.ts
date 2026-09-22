import type { SeatingMode, TierStatus } from './checkout.types';

export const WAITLIST_CLOSED = 'This event does not have a waitlist.';
export const WAITLIST_TICKETS_LEFT =
  'Tickets are still available — book one instead of joining the waitlist.';
export const WAITLIST_RESERVED_SEATING =
  'The waitlist is for general-admission tickets; this event seats people by seat.';

const SOLD_OUT: TierStatus = 'soldout';
const GENERAL_ADMISSION: SeatingMode = 'ga';

/**
 * Whether a buyer may join a ticket's waitlist rather than buy it (US-REG-04),
 * and if not, the sentence that says why.
 *
 * Three conditions, each a different reason to say no:
 * - the organizer switched the waitlist on — off, the event "simply shows sold
 *   out";
 * - the ticket is SOLD OUT, by the catalog's live status. Paused or not yet on
 *   sale is the organizer withholding it, not demand the event cannot meet;
 * - the event is general admission. An offer from a reserved-seating waitlist
 *   would have to be one particular seat, picked for somebody who is not at
 *   the map to pick it.
 */
export function waitlistRefusal(
  event: { waitlistEnabled: boolean; seatingMode: SeatingMode },
  tier: { status: TierStatus },
): string | null {
  if (!event.waitlistEnabled) return WAITLIST_CLOSED;
  if (event.seatingMode !== GENERAL_ADMISSION) return WAITLIST_RESERVED_SEATING;
  if (tier.status !== SOLD_OUT) return WAITLIST_TICKETS_LEFT;
  return null;
}

export function canJoinWaitlist(
  event: { waitlistEnabled: boolean; seatingMode: SeatingMode },
  tier: { status: TierStatus },
): boolean {
  return waitlistRefusal(event, tier) === null;
}

/**
 * Whether new places on this event go to its waitlist (US-REG-04). The same
 * two event conditions as joining — switched on, general admission — and for
 * the same reasons: off, the event "simply shows sold out"; reserved, a place
 * is one particular seat that nobody in line is at the map to pick.
 */
export function hasOpenWaitlist(event: {
  waitlistEnabled: boolean;
  seatingMode: SeatingMode;
}): boolean {
  return event.waitlistEnabled && event.seatingMode === GENERAL_ADMISSION;
}

/**
 * A free registration is confirmed when its place comes up, not offered: the
 * story's "free tickets confirm immediately" — there is nothing to pay for by
 * a deadline.
 */
export function confirmsOnOffer(order: { totalSatang: number }): boolean {
  return order.totalSatang === 0;
}
