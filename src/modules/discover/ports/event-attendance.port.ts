/**
 * Discover's read-only view of "how many people are going?" — the one number on a
 * public event card that comes from registration data. Discover owns the
 * abstraction (DIP) and the Registration side binds the adapter, so the anonymous
 * browse surface composes event *content* from the event's own tables but never
 * reaches into orders, attendees or tickets itself.
 */
export abstract class EventAttendancePort {
  /**
   * Confirmed admissions per event, keyed by event id. Events with none are
   * absent from the map rather than mapped to `0`, so the caller decides.
   *
   * Anonymous by design: a Discover card is public, so this crosses tenants and
   * exposes nothing but a count.
   */
  abstract goingCounts(eventIds: string[]): Promise<Map<string, number>>;
}
