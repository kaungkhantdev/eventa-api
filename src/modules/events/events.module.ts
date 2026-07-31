import { Module, forwardRef } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { PlatformModule } from '../platform/platform.module';
import { RegistrationModule } from '../registration/registration.module';
import { TicketingModule } from '../ticketing/ticketing.module';
import { CategoriesController } from './categories/categories.controller';
import { CategoriesRepository } from './categories/categories.repository';
import { CategoriesService } from './categories/categories.service';
import { EventsController } from './events.controller';
import { EventsRepository } from './events.repository';
import { EventsService } from './events.service';
import { AdminGuard } from './guards/admin.guard';
import { MonitorController } from './monitoring/monitor.controller';
import { MonitorService } from './monitoring/monitor.service';
import { SharingController } from './sharing/sharing.controller';
import { SharingService } from './sharing/sharing.service';

/**
 * Events & Program bounded context: create/manage events, categories, tickets,
 * seating, and publishing. Depends on the global DatabaseModule (DRIZZLE), the
 * app-wide JwtAuthGuard (IdentityModule), the transactional outbox (PlatformModule,
 * for the "event published" notice), and TicketAvailabilityPort from Ticketing
 * (the publish gate's "≥1 ticket" check) — wired with `forwardRef`.
 */
@Module({
  imports: [
    IdentityModule,
    PlatformModule,
    forwardRef(() => TicketingModule),
    RegistrationModule,
  ],
  controllers: [
    EventsController,
    CategoriesController,
    SharingController,
    MonitorController,
  ],
  providers: [
    EventsService,
    EventsRepository,
    CategoriesService,
    CategoriesRepository,
    SharingService,
    MonitorService,
    AdminGuard,
  ],
  exports: [EventsService],
})
export class EventsModule {}
