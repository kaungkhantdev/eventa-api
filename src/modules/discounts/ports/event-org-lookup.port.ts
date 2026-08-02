/**
 * Discounts-owned port: which workspace does this event belong to?
 *
 * An attendee applying a code at checkout has no tenant context of their own —
 * the event decides it. Resolving the workspace from the event (rather than from
 * anything the caller sends) is what makes it impossible to match a code from
 * someone else's workspace. Events implements it.
 */
export abstract class EventOrgLookupPort {
  /** The event's organization id, or null when no such live event exists. */
  abstract organizationIdFor(eventId: string): Promise<number | null>;
}
