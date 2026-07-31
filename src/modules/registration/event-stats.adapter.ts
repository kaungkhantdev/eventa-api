import { Injectable } from '@nestjs/common';
import {
  type AttendeesResult,
  type EventStatsOverview,
  EventStatsPort,
  type RegistrationsQuery,
  type RegistrationsResult,
  type StatsPage,
} from '../events/ports/event-stats.port';
import { EventStatsRepository } from './event-stats.repository';

/** Registration's implementation of the Events-owned Monitor read port (US-EVT-14). */
@Injectable()
export class EventStatsAdapter extends EventStatsPort {
  constructor(private readonly repo: EventStatsRepository) {
    super();
  }

  overview(
    organizationId: number,
    eventId: string,
  ): Promise<EventStatsOverview> {
    return this.repo.overview(organizationId, eventId);
  }

  registrations(
    organizationId: number,
    eventId: string,
    query: RegistrationsQuery,
  ): Promise<RegistrationsResult> {
    return this.repo.registrations(organizationId, eventId, query);
  }

  attendees(
    organizationId: number,
    eventId: string,
    page: StatsPage,
  ): Promise<AttendeesResult> {
    return this.repo.attendees(organizationId, eventId, page);
  }
}
