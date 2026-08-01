import { Injectable } from '@nestjs/common';
import { EventResponseDto } from '../events/dto/event-response.dto';
import type { EventActor } from '../events/events.types';
import { EventsService } from '../events/events.service';
import { SessionsService } from '../event-program/sessions.service';
import { SpeakersService } from '../event-program/speakers.service';
import { EventSeatingService } from '../event-seating/event-seating.service';
import { TicketingService } from '../ticketing/ticketing.service';

/**
 * Duplicate an event into a fresh draft (US-EVT-13). Orchestrates each bounded
 * context to copy ITS OWN tables — basics, then tickets, speakers, agenda
 * (re-linked to the copied speakers), and the seat map. Sales/registration state
 * resets (0 sold, cleared sales windows). Steps run in dependency order; the copy
 * is a private draft, so a mid-way failure leaves a discardable partial draft.
 */
@Injectable()
export class EventDuplicationService {
  constructor(
    private readonly events: EventsService,
    private readonly tickets: TicketingService,
    private readonly speakers: SpeakersService,
    private readonly sessions: SessionsService,
    private readonly seating: EventSeatingService,
  ) {}

  async duplicate(
    actor: EventActor,
    srcEventId: string,
  ): Promise<EventResponseDto> {
    const copy = await this.events.duplicateBasics(actor, srcEventId);
    await this.tickets.cloneForEvent(actor, srcEventId, copy.id);
    const speakerIdMap = await this.speakers.cloneForEvent(
      actor,
      srcEventId,
      copy.id,
    );
    await this.sessions.cloneForEvent(actor, srcEventId, copy.id, speakerIdMap);
    await this.seating.cloneForEvent(actor, srcEventId, copy.id);
    return copy;
  }
}
