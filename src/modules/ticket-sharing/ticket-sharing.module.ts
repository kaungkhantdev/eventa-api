import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { EventsModule } from '../events/events.module';
import { TicketingModule } from '../ticketing/ticketing.module';
import { TicketSharingController } from './ticket-sharing.controller';
import { TicketSharingService } from './ticket-sharing.service';

/**
 * Turns one ticket type into something an organizer can put on a poster
 * (US-TKT-06): a registration link with the tier preselected, and a matching
 * printable QR.
 *
 * Owns no tables. It asks EventsService for the event and TicketingService for
 * the tier, so the link and the publish gate always reflect what those contexts
 * actually hold. Sibling of `event-sharing`, which does the same for an event.
 */
@Module({
  imports: [EventsModule, TicketingModule, AccessModule],
  controllers: [TicketSharingController],
  providers: [TicketSharingService],
})
export class TicketSharingModule {}
