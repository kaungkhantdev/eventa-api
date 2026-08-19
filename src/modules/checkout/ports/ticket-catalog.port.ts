import type { CheckoutTier } from '../checkout.types';

/**
 * Checkout's read-only view of an event's sellable tiers — name, price, and the
 * bounds a selection is judged against. Checkout owns the abstraction (DIP) and
 * the Ticketing module binds the adapter.
 *
 * Prices come from here and nowhere else. That is the point of the port: the
 * money path must read the tier at the instant it prices the order, not trust a
 * price the client echoed back from a page it loaded ten minutes ago.
 */
export abstract class TicketCatalogPort {
  /** Every live tier of one event, cheapest decision left to the caller. */
  abstract tiersForEvent(
    organizationId: number,
    eventId: string,
  ): Promise<CheckoutTier[]>;

  /** One tier scoped to its event, or null when it does not exist there. */
  abstract tierById(
    organizationId: number,
    eventId: string,
    ticketTypeId: string,
  ): Promise<CheckoutTier | null>;
}
