import { Module, forwardRef } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { PlatformModule } from '../platform/platform.module';
import { TicketingModule } from '../ticketing/ticketing.module';
import { EventsController } from './events.controller';
import { EventsRepository } from './events.repository';
import { EventsService } from './events.service';
import { AdminGuard } from './guards/admin.guard';

/**
 * Events & Program bounded context: create/manage events, categories, tickets,
 * seating, and publishing. Depends on the global DatabaseModule (DRIZZLE), the
 * app-wide JwtAuthGuard (IdentityModule), the transactional outbox (PlatformModule,
 * for the "event published" notice), and TicketAvailabilityPort from Ticketing
 * (the publish gate's "≥1 ticket" check) — wired with `forwardRef`.
 */
@Module({
  imports: [IdentityModule, PlatformModule, forwardRef(() => TicketingModule)],
  controllers: [EventsController],
  providers: [EventsService, EventsRepository, AdminGuard],
  exports: [EventsService],
})
export class EventsModule {}
