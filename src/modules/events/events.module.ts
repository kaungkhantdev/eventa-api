import { Module, forwardRef } from '@nestjs/common';
import { AdminGuard } from '../../common/guards/admin.guard';
import { AccessModule } from '../access/access.module';
import { PlatformModule } from '../platform/platform.module';
import { TicketingModule } from '../ticketing/ticketing.module';
import { EventsController } from './events.controller';
import { EventsRepository } from './events.repository';
import { EventsService } from './events.service';

/**
 * Events bounded context: create/manage events and publish them. Depends on the
 * global DatabaseModule (DRIZZLE), the app-wide JwtAuthGuard (AccessModule), the
 * transactional outbox (PlatformModule, for the "event published" notice), and
 * TicketAvailabilityPort from Ticketing (the publish gate's "≥1 ticket" check) —
 * wired with `forwardRef`.
 *
 * Each event sub-domain is its own module depending on this one's service:
 * event-categories · event-program · event-seating · event-sharing ·
 * event-monitoring · event-duplication.
 */
@Module({
  imports: [AccessModule, PlatformModule, forwardRef(() => TicketingModule)],
  controllers: [EventsController],
  providers: [EventsService, EventsRepository, AdminGuard],
  exports: [EventsService],
})
export class EventsModule {}
