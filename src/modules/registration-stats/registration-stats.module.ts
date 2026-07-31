import { Module } from '@nestjs/common';
import { EventStatsPort } from '../events/ports/event-stats.port';
import { RegistrationStatsAdapter } from './registration-stats.adapter';
import { RegistrationStatsRepository } from './registration-stats.repository';

/**
 * The registration read model: implements EventStatsPort for the Events context
 * (the event-workspace Monitor, US-EVT-14) so Events never reads the
 * orders/tickets/payments tables directly. Read-only — the money path lives in
 * RegistrationModule.
 */
@Module({
  providers: [
    RegistrationStatsRepository,
    { provide: EventStatsPort, useClass: RegistrationStatsAdapter },
  ],
  exports: [EventStatsPort],
})
export class RegistrationStatsModule {}
