import { Module, forwardRef } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { TicketAvailabilityPort } from '../events/ports/ticket-availability.port';
import { AccessModule } from '../access/access.module';
import { TicketAvailabilityAdapter } from './ticket-availability.adapter';
import { TicketingRepository } from './ticketing.repository';
import { TicketingService } from './ticketing.service';
import { TicketingController } from './ticketing.controller';

/**
 * Ticketing bounded context: sellable ticket tiers per event. Depends on the
 * Events service (to verify the event is in the caller's tenant) and AccessModule
 * (the RBAC PermissionsGuard) — never on the events tables directly. Provides
 * TicketAvailabilityPort back to Events for the publish gate; the two contexts
 * reference each other (`forwardRef`) — an event has tickets, a ticket an event.
 */
@Module({
  imports: [forwardRef(() => EventsModule), AccessModule],
  controllers: [TicketingController],
  providers: [
    TicketingService,
    TicketingRepository,
    { provide: TicketAvailabilityPort, useClass: TicketAvailabilityAdapter },
  ],
  exports: [TicketingService, TicketAvailabilityPort],
})
export class TicketingModule {}
