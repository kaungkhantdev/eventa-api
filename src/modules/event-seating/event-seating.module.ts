import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { TicketingModule } from '../ticketing/ticketing.module';
import { EventsModule } from '../events/events.module';
import { RegistrationModule } from '../registration/registration.module';
import { EventSeatingController } from './event-seating.controller';
import { EventSeatingPolicy } from './event-seating.policy';
import { EventSeatingRepository } from './event-seating.repository';
import { EventSeatingService } from './event-seating.service';

/**
 * Seating sub-context of Events & Program: reserved seat maps + general-admission
 * headcount, the rows of a map split between the event's ticket types
 * (US-EVT-05). Depends on the Events service (event verification + seating-mode
 * updates), Ticketing (the seat-map-vs-ticket-quantity shortfall, and
 * `TicketQuantityPort`: the event's ticket types, locked and given their
 * seat-derived quantities inside the seat map's own transaction), Registration
 * (`SeatOccupancyPort`: which seats are booked or held, so their row keeps its
 * type) and AccessModule (the RBAC PermissionsGuard). A leaf importer — no cycles.
 */
@Module({
  imports: [EventsModule, TicketingModule, RegistrationModule, AccessModule],
  controllers: [EventSeatingController],
  providers: [EventSeatingService, EventSeatingRepository, EventSeatingPolicy],
  exports: [EventSeatingService],
})
export class EventSeatingModule {}
