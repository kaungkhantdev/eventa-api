import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { TicketingModule } from '../ticketing/ticketing.module';
import { EventsModule } from '../events/events.module';
import { EventSeatingController } from './event-seating.controller';
import { EventSeatingRepository } from './event-seating.repository';
import { EventSeatingService } from './event-seating.service';

/**
 * Seating sub-context of Events & Program: reserved seat maps + general-admission
 * headcount. Depends on the Events service (event verification + seating-mode
 * updates), the Ticketing port (seat-map-vs-ticket-quantity shortfall) and
 * AccessModule (the RBAC PermissionsGuard). A leaf importer — no cycles.
 */
@Module({
  imports: [EventsModule, TicketingModule, AccessModule],
  controllers: [EventSeatingController],
  providers: [EventSeatingService, EventSeatingRepository],
  exports: [EventSeatingService],
})
export class EventSeatingModule {}
