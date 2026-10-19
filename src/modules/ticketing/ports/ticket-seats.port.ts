/**
 * Ticketing asks Registration how many seats of an event's reserved map each
 * ticket type's rows hold (US-EVT-05) — on a reserved event whose rows have
 * types, that IS the type's quantity, so Ticketing shows it read-only and
 * refuses to retire a type that still sells rows. Registration binds the
 * adapter: it already reads the seat map for the checkout, and Seating (which
 * owns the seats) depends on Ticketing, so it cannot answer without a cycle.
 * Ticketing and Registration are already wired both ways (`forwardRef`).
 */
export abstract class TicketSeatsPort {
  /** Seats per ticket type on the event's map; a type with none is absent. */
  abstract seatsByTicketType(
    organizationId: number,
    eventId: string,
  ): Promise<Map<string, number>>;

  /** Of `eventIds`, the events whose map has a seat with a ticket type. */
  abstract eventsWithTypedSeats(
    organizationId: number,
    eventIds: string[],
  ): Promise<Set<string>>;
}
