import { Injectable } from '@nestjs/common';
import { EventAttendancePort } from '../discover/ports/event-attendance.port';
import { RegistrationStatsRepository } from './registration-stats.repository';

/**
 * Registration's implementation of the Discover-owned attendance port
 * (US-DISC-01), so the anonymous browse grid can show "how many are going"
 * without joining to orders itself.
 */
@Injectable()
export class EventAttendanceAdapter extends EventAttendancePort {
  constructor(private readonly repo: RegistrationStatsRepository) {
    super();
  }

  goingCounts(eventIds: string[]): Promise<Map<string, number>> {
    return this.repo.goingCounts(eventIds);
  }
}
