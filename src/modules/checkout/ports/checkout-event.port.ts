import type { CheckoutEvent } from '../checkout.types';

/**
 * Checkout's read-only view of the event being bought. Checkout owns the
 * abstraction (DIP); the Events module binds the adapter, so the money path never
 * reads the `events` table itself.
 *
 * Both lookups return only a PUBLISHED, publicly-visible event: resolving an
 * event is also the authorization check on this anonymous surface, so a draft or
 * private event is indistinguishable from one that does not exist. The
 * `organizationId` on the result is what establishes the tenant for the rest of
 * the checkout — it is never taken from the caller.
 */
export abstract class CheckoutEventPort {
  abstract findPublishedBySlug(slug: string): Promise<CheckoutEvent | null>;

  abstract findPublishedById(eventId: string): Promise<CheckoutEvent | null>;
}
