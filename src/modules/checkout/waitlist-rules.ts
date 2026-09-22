import type { SeatingMode, TierStatus } from './checkout.types';

export const WAITLIST_CLOSED = 'This event does not have a waitlist.';
export const WAITLIST_TICKETS_LEFT =
  'Tickets are still available — book one instead of joining the waitlist.';
export const WAITLIST_RESERVED_SEATING =
  'The waitlist is for general-admission tickets; this event seats people by seat.';

const SOLD_OUT: TierStatus = 'soldout';

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
  if (event.seatingMode !== 'ga') return WAITLIST_RESERVED_SEATING;
  if (tier.status !== SOLD_OUT) return WAITLIST_TICKETS_LEFT;
  return null;
}

export function canJoinWaitlist(
  event: { waitlistEnabled: boolean; seatingMode: SeatingMode },
  tier: { status: TierStatus },
): boolean {
  return waitlistRefusal(event, tier) === null;
}
