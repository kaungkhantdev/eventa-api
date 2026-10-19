/** One seat row of the public seat map and the ticket types its seats sell. */
export interface PublicSeatRow {
  /** The row's number as stored: "1", "2", … */
  label: string;
  /**
   * One of the page's `tickets[].id` when every seat of the row sells it;
   * null when its seats differ or have none.
   */
  ticketTypeId: string | null;
  /**
   * Each seat's ticket type in seat-number order (index 0 = seat 1): one of
   * the page's `tickets[].id`, or null for a seat with no type.
   */
  seatTicketTypes: (string | null)[];
}

/**
 * How a reserved room's seats are split between ticket types (US-PAGE-05,
 * US-EVT-05) — the layout only: no seat status, holds or sales, ever.
 */
export interface PublicSeatMap {
  seatsPerRow: number;
  /** Every row of the map, in row-number order. */
  rows: PublicSeatRow[];
}

/**
 * The public page asks Seating how an event's seats are split between its
 * ticket types. PublicPages owns the abstraction; Seating binds the adapter,
 * because the seats are its table.
 */
export abstract class PublicSeatMapPort {
  /**
   * The event's seat map with each seat's ticket type — null when the event
   * has no map, or none of its seats has a type yet.
   */
  abstract typedSeatMap(
    organizationId: number,
    eventId: string,
  ): Promise<PublicSeatMap | null>;
}
