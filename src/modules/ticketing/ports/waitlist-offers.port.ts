/**
 * Ticketing-owned port: "this ticket's allocation just grew — give the new
 * places to the people waiting for it" (US-REG-04). Checkout implements it,
 * because the waitlist is orders and the places are seat holds, and Ticketing
 * must read neither.
 *
 * The line is served strictly in order, exactly as an organizer's offer
 * serves one person: a paid registration is held its places for the offer
 * window and sent the offer; a free one is confirmed. It stops at the first
 * person whose request no longer fits — nobody is skipped. On an event that
 * requires approval nobody is given a place: that is the organizer's decision.
 */
export abstract class WaitlistOffersPort {
  /**
   * Resolves to how many waitlisted registrations were given a place. Never
   * rejects: the capacity change it follows is already saved, and an offer
   * that fails part-way reports the ones already made.
   */
  abstract offerNewPlaces(
    organizationId: number,
    eventId: string,
    ticketTypeId: string,
  ): Promise<number>;
}
