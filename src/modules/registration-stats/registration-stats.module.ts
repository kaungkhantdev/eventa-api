import { Module } from '@nestjs/common';
import { EventAttendancePort } from '../discover/ports/event-attendance.port';
import { EventStatsPort } from '../events/ports/event-stats.port';
import { EventAttendanceAdapter } from './event-attendance.adapter';
import { RegistrationStatsAdapter } from './registration-stats.adapter';
import { RegistrationStatsRepository } from './registration-stats.repository';

/**
 * The registration read model. It implements two consumer-owned ports so neither
 * consumer touches the orders/tickets/payments tables:
 *   · `EventStatsPort` for Events — the event-workspace Monitor (US-EVT-14).
 *   · `EventAttendancePort` for Discover — "how many are going" on a public card
 *     (US-DISC-01), the one anonymous, cross-tenant read here.
 * Read-only throughout; the money path lives in RegistrationModule.
 */
@Module({
  providers: [
    RegistrationStatsRepository,
    { provide: EventStatsPort, useClass: RegistrationStatsAdapter },
    { provide: EventAttendancePort, useClass: EventAttendanceAdapter },
  ],
  exports: [EventStatsPort, EventAttendancePort],
})
export class RegistrationStatsModule {}
