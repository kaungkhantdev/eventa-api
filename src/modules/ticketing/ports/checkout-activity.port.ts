/**
 * Ticketing-owned port answering "is anyone checking out with this tier right
 * now?" (US-TKT-05). Registration implements it — Ticketing must not read
 * `seat_holds`, which belongs to that context.
 *
 * It exists so retiring a tier never yanks inventory out from under a buyer who
 * is mid-payment: the organizer is told to pause it and try again shortly, which
 * stops new holds while the in-flight ones drain.
 */
export abstract class CheckoutActivityPort {
  /** True while at least one unexpired hold still reserves this tier. */
  abstract hasActiveHolds(
    organizationId: number,
    ticketTypeId: string,
  ): Promise<boolean>;
}
