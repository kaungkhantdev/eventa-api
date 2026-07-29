/**
 * The Events context depends on this abstraction (DIP) to answer one publish-gate
 * question — "does this event have at least one ticket type?" — without reaching
 * into the Ticketing module's tables. The Ticketing module binds the concrete
 * implementation; the two contexts are wired with `forwardRef` (an event has
 * tickets; a ticket belongs to an event — a legitimate bidirectional relationship).
 */
export abstract class TicketAvailabilityPort {
  /** Count of live (non-deleted) ticket tiers for an event in this org. */
  abstract activeCount(
    organizationId: number,
    eventId: string,
  ): Promise<number>;
}
