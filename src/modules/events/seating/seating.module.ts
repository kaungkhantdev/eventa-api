import { Module } from '@nestjs/common';
import { IdentityModule } from '../../identity/identity.module';
import { TicketingModule } from '../../ticketing/ticketing.module';
import { EventsModule } from '../events.module';
import { SeatingController } from './seating.controller';
import { SeatingRepository } from './seating.repository';
import { SeatingService } from './seating.service';

/**
 * Seating sub-context of Events & Program: reserved seat maps + general-admission
 * headcount. Depends on the Events service (event verification + seating-mode
 * updates), the Ticketing port (seat-map-vs-ticket-quantity shortfall) and
 * IdentityModule (the RBAC PermissionsGuard). A leaf importer — no cycles.
 */
@Module({
  imports: [EventsModule, TicketingModule, IdentityModule],
  controllers: [SeatingController],
  providers: [SeatingService, SeatingRepository],
})
export class SeatingModule {}
