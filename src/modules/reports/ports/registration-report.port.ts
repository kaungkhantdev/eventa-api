/**
 * What Reports needs to know about registrations, without reading the orders
 * tables (US-RPT-08).
 *
 * Declared here, by the consumer, and implemented by RegistrationStats — the
 * module that already owns the registration read model. Reports spans four
 * contexts; if it read their tables directly it would break the moment any of
 * them changed a column, and it would be the one module in the codebase allowed
 * to do so.
 */

/**
 * One event's registrations, split by the state each is in.
 *
 * `rejected` is carried even though US-RPT-08 lists only four states: it is a
 * real order status, deliberately distinct from `cancelled` (the buyer's own
 * withdrawal), and dropping it would print a total larger than its parts. The
 * story's requirement is that the parts sum to the whole, which they do.
 */
export interface RegistrationSplit {
  eventId: string;
  eventName: string;
  /** Bangkok-day start of the event, for the report's ordering and its meta line. */
  startAt: Date;
  confirmed: number;
  pending: number;
  waitlisted: number;
  cancelled: number;
  rejected: number;
  /** The sum of the five above. Computed by the owner, not by the caller. */
  total: number;
}

/** The slice being asked about, before paging. */
export interface RegistrationWindow {
  /** Registrations placed inside this window. */
  from: Date;
  /** Exclusive. */
  to: Date;
  /** One event, or every event in the workspace when absent. */
  eventId?: string;
  /** Matches the event name; the report has no attendee rows to search. */
  search?: string;
}

export interface RegistrationSplitQuery extends RegistrationWindow {
  page: number;
  limit: number;
}

/** The same five states, summed across everything the filter matches. */
export type RegistrationTotals = Omit<
  RegistrationSplit,
  'eventId' | 'eventName' | 'startAt'
>;

export interface RegistrationSplitPage {
  rows: RegistrationSplit[];
  /** How many EVENTS matched, for paging the rows. */
  matchedEvents: number;
  /**
   * Summed over the whole filter, not the page.
   *
   * US-RPT-08 requires the tiles to match the overview's registrations figure
   * for the same scope, and a tile computed from twenty visible rows would
   * disagree with it on every page but the first.
   */
  totals: RegistrationTotals;
}

/**
 * One ticket type's share of the sign-ups (US-RPT-03).
 *
 * SEATS, not order lines — the same definition `confirmed` uses, so the donut's
 * centre can show the overview's own registrations figure rather than a second
 * number that nearly matches it.
 */
export interface TicketShare {
  ticketTypeName: string;
  seats: number;
}

export abstract class RegistrationReportPort {
  abstract splitByEvent(
    organizationId: number,
    query: RegistrationSplitQuery,
  ): Promise<RegistrationSplitPage>;

  /**
   * The same split with no rows, for the overview's registrations tile and the
   * previous period it is compared against (US-RPT-01).
   */
  abstract totalsFor(
    organizationId: number,
    window: RegistrationWindow,
  ): Promise<RegistrationTotals>;

  /** The split by ticket type, largest first (US-RPT-03). */
  abstract ticketMix(
    organizationId: number,
    window: RegistrationWindow,
  ): Promise<TicketShare[]>;
}
