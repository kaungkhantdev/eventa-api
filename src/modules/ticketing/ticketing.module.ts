import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { IdentityModule } from '../identity/identity.module';
import { TicketingRepository } from './ticketing.repository';
import { TicketingService } from './ticketing.service';
import { TicketsController } from './tickets.controller';

/**
 * Ticketing bounded context: sellable ticket tiers per event. Depends on the
 * Events service (to verify the event is in the caller's tenant) and IdentityModule
 * (the RBAC PermissionsGuard) — never on the events tables directly.
 */
@Module({
  imports: [EventsModule, IdentityModule],
  controllers: [TicketsController],
  providers: [TicketingService, TicketingRepository],
  exports: [TicketingService],
})
export class TicketingModule {}
