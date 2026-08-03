import { Injectable } from '@nestjs/common';
import type { CheckoutSeat } from '../checkout/checkout.types';
import { SeatMapPort } from '../checkout/ports/seat-map.port';
import { SeatHoldRepository } from './seat-hold.repository';

/**
 * Registration's implementation of the Checkout-owned seat-map port
 * (US-DISC-04). It lives here because "free right now" folds in the live holds
 * and assignments the hold engine already owns — one answer to that question
 * rather than two that can drift apart.
 */
@Injectable()
export class SeatMapAdapter extends SeatMapPort {
  constructor(private readonly repo: SeatHoldRepository) {
    super();
  }

  seatsForEvent(
    organizationId: number,
    eventId: string,
    now: Date,
    ownHoldIds?: number[],
  ): Promise<CheckoutSeat[]> {
    return this.repo.seatsForEvent(organizationId, eventId, now, ownHoldIds);
  }
}
