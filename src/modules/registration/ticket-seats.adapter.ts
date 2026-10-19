import { Injectable } from '@nestjs/common';
import { TicketSeatsPort } from '../ticketing/ports/ticket-seats.port';
import { SeatHoldRepository } from './seat-hold.repository';

/**
 * Registration's implementation of Ticketing's `TicketSeatsPort` (US-EVT-05):
 * how many seats of an event's map each ticket type's rows hold, read from the
 * same seat map the checkout draws.
 */
@Injectable()
export class TicketSeatsAdapter extends TicketSeatsPort {
  constructor(private readonly repo: SeatHoldRepository) {
    super();
  }

  seatsByTicketType(
    organizationId: number,
    eventId: string,
  ): Promise<Map<string, number>> {
    return this.repo.seatsByTicketType(organizationId, eventId);
  }

  eventsWithTypedSeats(
    organizationId: number,
    eventIds: string[],
  ): Promise<Set<string>> {
    return this.repo.eventsWithTypedSeats(organizationId, eventIds);
  }
}
