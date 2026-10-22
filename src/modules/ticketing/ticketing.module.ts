import { Module, forwardRef } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { TicketAvailabilityPort } from '../events/ports/ticket-availability.port';
import { AccessModule } from '../access/access.module';
import { TicketSalesPort } from '../payment-settings/ports/ticket-sales.port';
import { RegistrationModule } from '../registration/registration.module';
import { CheckoutModule } from '../checkout/checkout.module';
import { TicketEligibilityPort } from '../registration/ports/ticket-eligibility.port';
import { TicketCatalogPort } from '../checkout/ports/ticket-catalog.port';
import { CheckoutCatalogAdapter } from './checkout-catalog.adapter';
import { TicketQuantityPort } from '../event-seating/ports/ticket-quantity.port';
import { TicketQuantityAdapter } from './ticket-quantity.adapter';
import { TicketAvailabilityAdapter } from './ticket-availability.adapter';
import { TicketEligibilityAdapter } from './ticket-eligibility.adapter';
import { TicketSalesAdapter } from './ticket-sales.adapter';
import { TicketingPolicy } from './ticketing.policy';
import { TicketingRepository } from './ticketing.repository';
import { TicketingService } from './ticketing.service';
import { TicketSeatQuantitiesService } from './ticket-seat-quantities.service';
import { TicketingController } from './ticketing.controller';
import { TicketingQueryController } from './ticketing-query.controller';
import { TicketingQueryService } from './ticketing-query.service';
import { InventoryInsightsPort } from '../dashboard/ports/operations-insights.port';
import { InventoryInsightsAdapter } from './inventory-insights.adapter';

/**
 * Ticketing bounded context: sellable ticket tiers per event. Depends on the
 * Events service (to verify the event is in the caller's tenant) and AccessModule
 * (the RBAC PermissionsGuard) — never on the events tables directly. Provides
 * TicketAvailabilityPort back to Events for the publish gate; the two contexts
 * reference each other (`forwardRef`) — an event has tickets, a ticket an event.
 *
 * Checkout, too, both ways (`forwardRef`): it reads the tiers through
 * TicketCatalogPort, and a raised allocation is handed to it through
 * `WaitlistOffersPort` so the new places go to the waitlist (US-REG-04) —
 * Ticketing never reads orders or holds seats itself.
 *
 * Seating reads and sets the tiers its seats sell through `TicketQuantityPort`
 * (US-EVT-05), inside the seat map's transaction; Seating imports this module,
 * not the other way round.
 */
@Module({
  imports: [
    forwardRef(() => EventsModule),
    forwardRef(() => RegistrationModule),
    forwardRef(() => CheckoutModule),
    AccessModule,
  ],
  controllers: [TicketingController, TicketingQueryController],
  providers: [
    { provide: InventoryInsightsPort, useClass: InventoryInsightsAdapter },
    TicketingService,
    TicketSeatQuantitiesService,
    TicketingQueryService,
    TicketingPolicy,
    TicketingRepository,
    { provide: TicketAvailabilityPort, useClass: TicketAvailabilityAdapter },
    { provide: TicketSalesPort, useClass: TicketSalesAdapter },
    { provide: TicketEligibilityPort, useClass: TicketEligibilityAdapter },
    { provide: TicketCatalogPort, useClass: CheckoutCatalogAdapter },
    { provide: TicketQuantityPort, useClass: TicketQuantityAdapter },
  ],
  exports: [
    InventoryInsightsPort,
    TicketingService,
    TicketAvailabilityPort,
    TicketSalesPort,
    TicketEligibilityPort,
    TicketCatalogPort,
    TicketQuantityPort,
  ],
})
export class TicketingModule {}
