import { Injectable } from '@nestjs/common';
import type { CheckoutEvent } from '../checkout/checkout.types';
import { CheckoutEventPort } from '../checkout/ports/checkout-event.port';
import { EventsRepository } from './events.repository';

/**
 * Events' implementation of the Checkout-owned event port (US-DISC-04), so the
 * anonymous checkout resolves what it is selling — and which workspace owns it —
 * without reading the `events` table itself.
 */
@Injectable()
export class CheckoutEventAdapter extends CheckoutEventPort {
  constructor(private readonly repo: EventsRepository) {
    super();
  }

  findPublishedBySlug(slug: string): Promise<CheckoutEvent | null> {
    return this.repo.findPublishedForCheckout({ slug });
  }

  findPublishedById(eventId: string): Promise<CheckoutEvent | null> {
    return this.repo.findPublishedForCheckout({ id: eventId });
  }

  findOwnedById(
    organizationId: number,
    eventId: string,
  ): Promise<CheckoutEvent | null> {
    return this.repo.findOwnedForCheckout(organizationId, eventId);
  }
}
