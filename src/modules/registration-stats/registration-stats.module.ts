import { Module } from '@nestjs/common';
import { EventAttendancePort } from '../discover/ports/event-attendance.port';
import { EventStatsPort } from '../events/ports/event-stats.port';
import { AttendanceReportPort } from '../reports/ports/attendance-report.port';
import { RegistrationReportPort } from '../reports/ports/registration-report.port';
import { EventAttendanceAdapter } from './event-attendance.adapter';
import { AttendanceReportAdapter } from './attendance-report.adapter';
import { RegistrationReportAdapter } from './registration-report.adapter';
import { RegistrationStatsAdapter } from './registration-stats.adapter';
import { RegistrationStatsRepository } from './registration-stats.repository';

/**
 * The registration read model. It implements two consumer-owned ports so neither
 * consumer touches the orders/tickets/payments tables:
 *   · `EventStatsPort` for Events — the event-workspace Monitor (US-EVT-14).
 *   · `RegistrationReportPort` for Reports — registrations by event and state
 *     (US-RPT-08).
 *   · `EventAttendancePort` for Discover — "how many are going" on a public card
 *     (US-DISC-01), the one anonymous, cross-tenant read here.
 * Read-only throughout; the money path lives in RegistrationModule.
 */
@Module({
  providers: [
    RegistrationStatsRepository,
    { provide: EventStatsPort, useClass: RegistrationStatsAdapter },
    { provide: EventAttendancePort, useClass: EventAttendanceAdapter },
    { provide: RegistrationReportPort, useClass: RegistrationReportAdapter },
    { provide: AttendanceReportPort, useClass: AttendanceReportAdapter },
  ],
  exports: [
    EventStatsPort,
    EventAttendancePort,
    RegistrationReportPort,
    AttendanceReportPort,
  ],
})
export class RegistrationStatsModule {}
