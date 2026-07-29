import { Injectable } from '@nestjs/common';
import { TicketAvailabilityPort } from '../events/ports/ticket-availability.port';
import { TicketingRepository } from './ticketing.repository';

/** Ticketing's implementation of the Events-owned publish-gate ticket check. */
@Injectable()
export class TicketAvailabilityAdapter extends TicketAvailabilityPort {
  constructor(private readonly repo: TicketingRepository) {
    super();
  }

  activeCount(organizationId: number, eventId: string): Promise<number> {
    return this.repo.countActive(organizationId, eventId);
  }
}
