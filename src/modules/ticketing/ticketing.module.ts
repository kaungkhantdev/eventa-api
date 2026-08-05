import { Module, forwardRef } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { TicketAvailabilityPort } from '../events/ports/ticket-availability.port';
import { AccessModule } from '../access/access.module';
import { TicketSalesPort } from '../payment-settings/ports/ticket-sales.port';
import { RegistrationModule } from '../registration/registration.module';
import { TicketEligibilityPort } from '../registration/ports/ticket-eligibility.port';
import { TicketCatalogPort } from '../checkout/ports/ticket-catalog.port';
import { CheckoutCatalogAdapter } from './checkout-catalog.adapter';
import { TicketAvailabilityAdapter } from './ticket-availability.adapter';
import { TicketEligibilityAdapter } from './ticket-eligibility.adapter';
import { TicketSalesAdapter } from './ticket-sales.adapter';
import { TicketingPolicy } from './ticketing.policy';
import { TicketingRepository } from './ticketing.repository';
import { TicketingService } from './ticketing.service';
import { TicketingController } from './ticketing.controller';
import { TicketingQueryController } from './ticketing-query.controller';
import { TicketingQueryService } from './ticketing-query.service';

/**
 * Ticketing bounded context: sellable ticket tiers per event. Depends on the
 * Events service (to verify the event is in the caller's tenant) and AccessModule
 * (the RBAC PermissionsGuard) — never on the events tables directly. Provides
 * TicketAvailabilityPort back to Events for the publish gate; the two contexts
 * reference each other (`forwardRef`) — an event has tickets, a ticket an event.
 */
@Module({
  imports: [
    forwardRef(() => EventsModule),
    forwardRef(() => RegistrationModule),
    AccessModule,
  ],
  controllers: [TicketingController, TicketingQueryController],
  providers: [
    TicketingService,
    TicketingQueryService,
    TicketingPolicy,
    TicketingRepository,
    { provide: TicketAvailabilityPort, useClass: TicketAvailabilityAdapter },
    { provide: TicketSalesPort, useClass: TicketSalesAdapter },
    { provide: TicketEligibilityPort, useClass: TicketEligibilityAdapter },
    { provide: TicketCatalogPort, useClass: CheckoutCatalogAdapter },
  ],
  exports: [
    TicketingService,
    TicketAvailabilityPort,
    TicketSalesPort,
    TicketEligibilityPort,
    TicketCatalogPort,
  ],
})
export class TicketingModule {}
