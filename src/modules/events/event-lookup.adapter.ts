import { Injectable } from '@nestjs/common';
import {
  type EventBrief,
  EventLookupPort,
} from '../ticketing/ports/event-lookup.port';
import { EventsRepository } from './events.repository';

/**
 * Events' implementation of Ticketing's `EventLookupPort` — it reads the `events`
 * table (which it owns) and hands back only ids and names, so the cross-event
 * ticket inventory can label and search tiers without ever joining events.
 */
@Injectable()
export class EventLookupAdapter extends EventLookupPort {
  constructor(private readonly repo: EventsRepository) {
    super();
  }

  async briefsByIds(
    organizationId: number,
    eventIds: string[],
  ): Promise<Map<string, EventBrief>> {
    const rows = await this.repo.briefsByIds(organizationId, eventIds);
    return new Map(rows.map((row) => [row.id, row]));
  }

  idsMatchingName(organizationId: number, search: string): Promise<string[]> {
    return this.repo.idsMatchingName(organizationId, search);
  }
}
