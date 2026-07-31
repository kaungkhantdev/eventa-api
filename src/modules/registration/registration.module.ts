import { Module } from '@nestjs/common';
import { EventStatsPort } from '../events/ports/event-stats.port';
import { EventStatsAdapter } from './event-stats.adapter';
import { EventStatsRepository } from './event-stats.repository';
import { SeatHoldRepository } from './seat-hold.repository';
import { SeatHoldService } from './seat-hold.service';

/**
 * Registration & Orders bounded context. Provides:
 * - the checkout seat-hold engine (reserve / release / expire inventory), the
 *   sanctioned money-path transaction (CLAUDE.md);
 * - EventStatsPort back to the Events context (the event-workspace Monitor read
 *   model, US-EVT-14) so Events never reads the orders/payments tables directly.
 * The HTTP surface and order/attendee write model arrive with the checkout
 * (`POST /orders`) slice.
 */
@Module({
  providers: [
    SeatHoldService,
    SeatHoldRepository,
    EventStatsRepository,
    { provide: EventStatsPort, useClass: EventStatsAdapter },
  ],
  exports: [SeatHoldService, EventStatsPort],
})
export class RegistrationModule {}
