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
   * Never rejects: the capacity change it follows is already saved. An offer
   * that fails part-way reports the ones already made and says it was cut
   * short.
   */
  abstract offerNewPlaces(
    organizationId: number,
    eventId: string,
    ticketTypeId: string,
  ): Promise<WaitlistOfferOutcome>;
}

/** What a raised allocation's new places did for the waitlist. */
export interface WaitlistOfferOutcome {
  /** Waitlisted registrations given a place, in line order. */
  readonly offered: number;
  /**
   * The offers stopped on a failure, not because the line ran out or the
   * person at the front did not fit. The raised allocation is saved and on
   * sale regardless, so places the line never saw may now go to the public
   * first: the organizer needs to know to offer the rest by hand.
   */
  readonly interrupted: boolean;
}
