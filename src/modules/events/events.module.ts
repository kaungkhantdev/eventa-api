import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsRepository } from './events.repository';
import { EventsService } from './events.service';
import { AdminGuard } from './guards/admin.guard';

/**
 * Events & Program bounded context: create/manage events, categories, tickets,
 * seating, and publishing. Depends on the global DatabaseModule (DRIZZLE) and the
 * app-wide JwtAuthGuard registered by IdentityModule.
 */
@Module({
  controllers: [EventsController],
  providers: [EventsService, EventsRepository, AdminGuard],
  exports: [EventsService],
})
export class EventsModule {}
