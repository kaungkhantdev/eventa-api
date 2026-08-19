/**
 * The Events context depends on this abstraction (DIP) to read an event's live
 * performance — registrations, tickets, revenue, and the attendee roster — without
 * reaching into the Registration/Payments tables. The Registration module binds the
 * concrete implementation. Powers the event-workspace Monitor (US-EVT-14).
 */

/** The payment states the Registrations tab can filter by (US-EVT-14). */
export type RegistrationStatusFilter = 'paid' | 'pending' | 'refunded';

/** Headline numbers for the Overview. Money is integer satang. */
export interface EventStatsOverview {
  /** Confirmed admissions booked (Σ seats of confirmed orders). */
  registrations: number;
  /** Live issued tickets (issued or checked-in). */
  ticketsSold: number;
  /** Captured revenue (Σ paid payments), in satang. */
  revenueSatang: number;
}

/** One row of the Registrations tab. */
export interface RegistrationRow {
  reference: string;
  attendeeName: string;
  tickets: number;
  amountSatang: number;
  paymentStatus: string;
  registeredAt: Date;
}

/** Per-payment-status counts for the Registrations tab badges. */
export interface RegistrationStatusCounts {
  all: number;
  paid: number;
  pending: number;
  refunded: number;
}

export interface RegistrationsResult {
  items: RegistrationRow[];
  total: number;
  statusCounts: RegistrationStatusCounts;
}

/** One confirmed attendee (a distinct registrant), gated behind regView. */
export interface AttendeeRow {
  name: string;
  email: string;
  registrations: number;
  seats: number;
}

export interface AttendeesResult {
  items: AttendeeRow[];
  total: number;
}

/** Offset paging for a stats query. */
export interface StatsPage {
  limit: number;
  offset: number;
}

export interface RegistrationsQuery extends StatsPage {
  status?: RegistrationStatusFilter;
}

export abstract class EventStatsPort {
  /** Overview headline numbers for one event. */
  abstract overview(
    organizationId: number,
    eventId: string,
  ): Promise<EventStatsOverview>;

  /** A filtered, paged page of the event's registrations plus per-status counts. */
  abstract registrations(
    organizationId: number,
    eventId: string,
    query: RegistrationsQuery,
  ): Promise<RegistrationsResult>;

  /** The event's confirmed attendees (distinct registrants) plus the total count. */
  abstract attendees(
    organizationId: number,
    eventId: string,
    page: StatsPage,
  ): Promise<AttendeesResult>;

  /** How many confirmed attendees the event has (broadcast recipient count). */
  abstract attendeeCount(
    organizationId: number,
    eventId: string,
  ): Promise<number>;
}
