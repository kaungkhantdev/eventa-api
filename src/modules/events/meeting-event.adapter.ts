import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ilike, inArray, isNull } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { events } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import {
  type MeetingEvent,
  MeetingEventPort,
} from '../meetings/ports/meeting-event.port';

/**
 * Events' implementation of the Meetings-owned event port (E12), so the diary
 * labels its meetings and locates the in-person ones without joining `events`.
 *
 * Tenant-scoped throughout — which is also the authorization check: an event id
 * from another workspace resolves to nothing, so a meeting cannot be attached
 * to someone else's event.
 */
@Injectable()
export class MeetingEventAdapter extends MeetingEventPort {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {
    super();
  }

  async findForMeeting(
    organizationId: number,
    eventId: string,
  ): Promise<MeetingEvent | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({
          id: events.id,
          name: events.name,
          venueName: events.venueName,
        })
        .from(events)
        .where(
          and(
            eq(events.id, eventId),
            eq(events.organizationId, organizationId),
            isNull(events.deletedAt),
          ),
        )
        .limit(1);
      return row ?? null;
    });
  }

  async namesByIds(
    organizationId: number,
    eventIds: string[],
  ): Promise<Map<string, string>> {
    if (eventIds.length === 0) return new Map();
    return withTenant(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select({ id: events.id, name: events.name })
        .from(events)
        .where(
          and(
            eq(events.organizationId, organizationId),
            inArray(events.id, eventIds),
          ),
        );
      return new Map(rows.map((row) => [row.id, row.name]));
    });
  }

  async idsMatchingName(
    organizationId: number,
    search: string,
  ): Promise<string[]> {
    return withTenant(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select({ id: events.id })
        .from(events)
        .where(
          and(
            eq(events.organizationId, organizationId),
            ilike(events.name, `%${search}%`),
            isNull(events.deletedAt),
          ),
        );
      return rows.map((row) => row.id);
    });
  }
}
