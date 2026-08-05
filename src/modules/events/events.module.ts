import { Module, forwardRef } from '@nestjs/common';
import { AdminGuard } from '../../common/guards/admin.guard';
import { AccessModule } from '../access/access.module';
import { PlatformModule } from '../platform/platform.module';
import { TicketingModule } from '../ticketing/ticketing.module';
import { EventsController } from './events.controller';
import { CheckoutEventPort } from '../checkout/ports/checkout-event.port';
import { EventOrgLookupPort } from '../discounts/ports/event-org-lookup.port';
import { EventLookupPort } from '../ticketing/ports/event-lookup.port';
import { CheckoutEventAdapter } from './checkout-event.adapter';
import { EventOrgLookupAdapter } from './event-org-lookup.adapter';
import { EventLookupAdapter } from './event-lookup.adapter';
import { EventsRepository } from './events.repository';
import { EventsQueryService } from './events-query.service';
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
  providers: [
    EventsService,
    EventsQueryService,
    EventsRepository,
    AdminGuard,
    { provide: EventLookupPort, useClass: EventLookupAdapter },
    { provide: EventOrgLookupPort, useClass: EventOrgLookupAdapter },
    { provide: CheckoutEventPort, useClass: CheckoutEventAdapter },
  ],
  exports: [
    EventsService,
    EventsQueryService,
    EventLookupPort,
    EventOrgLookupPort,
    CheckoutEventPort,
  ],
})
export class EventsModule {}
