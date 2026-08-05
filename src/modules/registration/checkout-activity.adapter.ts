import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/time/clock';
import { CheckoutActivityPort } from '../ticketing/ports/checkout-activity.port';
import { SeatHoldRepository } from './seat-hold.repository';

/**
 * Registration's implementation of Ticketing's `CheckoutActivityPort`: it reads
 * `seat_holds` (which it owns) and answers a single yes/no, so Ticketing can
 * refuse to retire a tier mid-checkout without ever seeing a hold.
 */
@Injectable()
export class CheckoutActivityAdapter extends CheckoutActivityPort {
  constructor(
    private readonly repo: SeatHoldRepository,
    private readonly clock: Clock,
  ) {
    super();
  }

  hasActiveHolds(
    organizationId: number,
    ticketTypeId: string,
  ): Promise<boolean> {
    // Lapsed holds no longer reserve anything, so they must not block a retire.
    return this.repo.hasActiveHolds(
      organizationId,
      ticketTypeId,
      this.clock.now(),
    );
  }
}
