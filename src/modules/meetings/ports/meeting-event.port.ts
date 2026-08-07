/** The event facts a meeting needs: what to call it, and where it happens. */
export interface MeetingEvent {
  id: string;
  name: string;
  /** Where an In-person meeting about this event takes place (US-MTG-03). */
  venueName: string | null;
}

/**
 * Meetings' read-only view of the event a meeting is about. Meetings owns the
 * abstraction (DIP) and Events binds the adapter, so this module never joins
 * the `events` table.
 *
 * Tenant-scoped, and that IS the authorization check: an event id from another
 * workspace resolves to nothing, so a meeting can never be attached to someone
 * else's event.
 */
export abstract class MeetingEventPort {
  abstract findForMeeting(
    organizationId: number,
    eventId: string,
  ): Promise<MeetingEvent | null>;

  /** Names for the listed events, so a page of meetings labels in one query. */
  abstract namesByIds(
    organizationId: number,
    eventIds: string[],
  ): Promise<Map<string, string>>;

  /** Ids of this org's events whose name matches — so search spans events. */
  abstract idsMatchingName(
    organizationId: number,
    search: string,
  ): Promise<string[]>;
}
