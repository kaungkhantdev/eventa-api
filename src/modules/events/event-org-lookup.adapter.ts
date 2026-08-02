import { Injectable } from '@nestjs/common';
import { EventOrgLookupPort } from '../discounts/ports/event-org-lookup.port';
import { EventsRepository } from './events.repository';

/**
 * Events' implementation of Discounts' `EventOrgLookupPort`. It answers with the
 * event's own organization id — the only tenant an anonymous checkout is allowed
 * to reach, and never one the caller supplied.
 */
@Injectable()
export class EventOrgLookupAdapter extends EventOrgLookupPort {
  constructor(private readonly repo: EventsRepository) {
    super();
  }

  organizationIdFor(eventId: string): Promise<number | null> {
    return this.repo.organizationIdFor(eventId);
  }
}
