/** Where a reserved event's seat rows stand against its ticket types. */
export interface SeatRowsReadiness {
  /** Rows of the seat map with no ticket type. */
  rowsWithoutType: number;
  /** Names of the live ticket types no row sells, in the event's own order. */
  ticketTypesWithoutRows: string[];
}

/**
 * The publish gate's seating question (US-EVT-05): on a reserved event, does
 * every seat row have a ticket type, and every ticket type a row? Events owns
 * the abstraction; Seating binds the adapter, because the seats are its table.
 * The two modules depend on each other (`forwardRef`): Seating lays out an
 * event's room, and an event is not ready to publish until its room is.
 */
export abstract class SeatingReadinessPort {
  abstract seatRowsReadiness(
    organizationId: number,
    eventId: string,
  ): Promise<SeatRowsReadiness>;
}
