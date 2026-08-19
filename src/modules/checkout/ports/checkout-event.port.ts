import type { CheckoutEvent } from '../checkout.types';

/**
 * Checkout's read-only view of the event being bought. Checkout owns the
 * abstraction (DIP); the Events module binds the adapter, so the money path never
 * reads the `events` table itself.
 *
 * The two `findPublished*` lookups return only a PUBLISHED, publicly-visible
 * event: resolving an event is also the authorization check on that anonymous
 * surface, so a draft or private event is indistinguishable from one that does
 * not exist. The `organizationId` on the result is what establishes the tenant
 * for the rest of the checkout — it is never taken from the caller.
 */
export abstract class CheckoutEventPort {
  abstract findPublishedBySlug(slug: string): Promise<CheckoutEvent | null>;

  abstract findPublishedById(eventId: string): Promise<CheckoutEvent | null>;

  /**
   * The organizer's own event, for a booking they are making themselves
   * (US-REG-03). Deliberately NOT the public gate: an organizer must be able to
   * add a walk-up to an invite-only event, and to one already under way. The
   * tenant comes from the authenticated caller here rather than from the event,
   * which is the whole reason this is a separate lookup — passing an event id
   * from another workspace resolves to nothing.
   *
   * Still refuses a draft, completed or cancelled event: there is nothing to
   * register for.
   */
  abstract findOwnedById(
    organizationId: number,
    eventId: string,
  ): Promise<CheckoutEvent | null>;
}
