/** One seat row of the public seat map and the ticket type it sells. */
export interface PublicSeatRow {
  /** The row's number as stored: "1", "2", … */
  label: string;
  /** One of the page's `tickets[].id`; null for a row with no type. */
  ticketTypeId: string | null;
}

/**
 * How a reserved room's rows are split between ticket types (US-PAGE-05,
 * US-EVT-05) — the layout only: no seat status, holds or sales, ever.
 */
export interface PublicSeatMap {
  seatsPerRow: number;
  /** Every row of the map, in row-number order. */
  rows: PublicSeatRow[];
}

/**
 * The public page asks Seating how an event's seat rows are split between its
 * ticket types. PublicPages owns the abstraction; Seating binds the adapter,
 * because the seats are its table.
 */
export abstract class PublicSeatMapPort {
  /**
   * The event's seat map with each row's ticket type — null when the event has
   * no map, or none of its rows has a type yet.
   */
  abstract typedSeatMap(
    organizationId: number,
    eventId: string,
  ): Promise<PublicSeatMap | null>;
}
