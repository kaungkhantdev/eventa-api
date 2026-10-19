import { Injectable } from '@nestjs/common';
import type { EventActor } from '../events/events.types';
import { EventsService } from '../events/events.service';
import { TicketSeatsPort } from './ports/ticket-seats.port';
import { TicketingPolicy } from './ticketing.policy';

/**
 * The seats each ticket type's rows hold, on a reserved event whose rows have
 * types (US-EVT-05) — null on any other event, whose quantities are typed.
 */
export type SeatQuantities = ReadonlyMap<string, number> | null;

/**
 * Whether an event's seat map sets its ticket types' quantities, and to what
 * (US-EVT-05). A facet of Ticketing kept apart from `TicketingService`, which
 * would otherwise carry the event lookup and Registration's seat counts on top
 * of its own collaborators.
 */
@Injectable()
export class TicketSeatQuantitiesService {
  constructor(
    private readonly events: EventsService,
    private readonly seats: TicketSeatsPort,
    private readonly policy: TicketingPolicy,
  ) {}

  /**
   * The seats each ticket type's rows hold when the event's seat map sets its
   * quantities, else null. Reads the event through Events, so it is also the
   * 404 for an event outside the caller's workspace.
   */
  async forEvent(actor: EventActor, eventId: string): Promise<SeatQuantities> {
    const event = await this.events.getEvent(actor, eventId);
    const seats = await this.seats.seatsByTicketType(
      actor.organizationId,
      eventId,
    );
    return this.policy.quantityFromSeats(event.seatingMode, seats.size > 0)
      ? seats
      : null;
  }
}
