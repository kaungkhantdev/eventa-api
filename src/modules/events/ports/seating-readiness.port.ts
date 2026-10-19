/** Where a reserved event's seats stand against its ticket types. */
export interface SeatsReadiness {
  /** Seats of the seat map with no ticket type. */
  seatsWithoutType: number;
  /** Names of the live ticket types no seat sells, in the event's own order. */
  ticketTypesWithoutSeats: string[];
}

/**
 * The publish gate's seating question (US-EVT-05): on a reserved event, does
 * every seat have a ticket type, and every ticket type a seat? Events owns the
 * abstraction; Seating binds the adapter, because the seats are its table.
 * The two modules depend on each other (`forwardRef`): Seating lays out an
 * event's room, and an event is not ready to publish until its room is.
 */
export abstract class SeatingReadinessPort {
  abstract seatsReadiness(
    organizationId: number,
    eventId: string,
  ): Promise<SeatsReadiness>;
}
