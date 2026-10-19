import { Module, forwardRef } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { TicketingModule } from '../ticketing/ticketing.module';
import { EventsModule } from '../events/events.module';
import { SeatingReadinessPort } from '../events/ports/seating-readiness.port';
import { PublicSeatMapPort } from '../public-pages/ports/public-seat-map.port';
import { RegistrationModule } from '../registration/registration.module';
import { EventSeatingController } from './event-seating.controller';
import { EventSeatingPolicy } from './event-seating.policy';
import { EventSeatingRepository } from './event-seating.repository';
import { EventSeatingService } from './event-seating.service';
import { PublicSeatMapAdapter } from './public-seat-map.adapter';
import { SeatingReadinessAdapter } from './seating-readiness.adapter';

/**
 * Seating sub-context of Events & Program: reserved seat maps + general-admission
 * headcount, the rows of a map split between the event's ticket types
 * (US-EVT-05). Depends on the Events service (event verification + seating-mode
 * updates), Ticketing (the seat-map-vs-ticket-quantity shortfall, and
 * `TicketQuantityPort`: the event's ticket types, locked and given their
 * seat-derived quantities inside the seat map's own transaction), Registration
 * (`SeatOccupancyPort`: which seats are booked or held, so their row keeps its
 * type) and AccessModule (the RBAC PermissionsGuard).
 *
 * Events and Seating depend on each other (`forwardRef`): Seating lays out an
 * event's room through the Events service, and Events' publish gate asks
 * Seating, through `SeatingReadinessPort` (bound here), whether every seat row
 * has a ticket type and every ticket type a row (US-EVT-05). Ticketing is
 * imported with `forwardRef` too — not because it depends on Seating, but
 * because it imports Events, which now imports this module, so the plain
 * import would still be loading when this decorator runs.
 *
 * It also binds PublicPages' `PublicSeatMapPort`: the public page shows how
 * the rows are split between ticket types, and nothing else about the seats
 * (US-PAGE-05).
 */
@Module({
  imports: [
    forwardRef(() => EventsModule),
    forwardRef(() => TicketingModule),
    RegistrationModule,
    AccessModule,
  ],
  controllers: [EventSeatingController],
  providers: [
    EventSeatingService,
    EventSeatingRepository,
    EventSeatingPolicy,
    { provide: SeatingReadinessPort, useClass: SeatingReadinessAdapter },
    { provide: PublicSeatMapPort, useClass: PublicSeatMapAdapter },
  ],
  exports: [EventSeatingService, SeatingReadinessPort, PublicSeatMapPort],
})
export class EventSeatingModule {}
