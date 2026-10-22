import type { seatMaps, seats } from '../../db/schema';
import type { SeatTier } from './ports/ticket-quantity.port';

/** A selected `seat_maps` row. */
export type SeatMapRow = typeof seatMaps.$inferSelect;
/** A `seat_maps` insert shape. */
export type NewSeatMapValues = typeof seatMaps.$inferInsert;
/** A selected `seats` row. */
export type SeatRow = typeof seats.$inferSelect;
/** A `seats` insert shape. */
export type NewSeatValues = typeof seats.$inferInsert;
/** `seat_status` enum. */
export type SeatStatus = SeatRow['status'];

/** A seat position within a map (before it gets a map id). */
export interface SeatPosition {
  section: string | null;
  rowLabel: string;
  seatNumber: string;
}

/** A seat position with the ticket type it sells (null for none). */
export interface NewSeatPosition extends SeatPosition {
  ticketTypeId: string | null;
}

/**
 * Each row's ticket type, index 0 = row "1"; null is a row with no type. The
 * shorthand for giving every seat of a row the same type (US-EVT-05).
 */
export type RowTicketTypes = readonly (string | null)[];

/**
 * Each seat's ticket type: one list per row (index 0 = row "1"), one entry per
 * seat (index 0 = seat "1"); null is a seat with no type (US-EVT-05).
 */
export type SeatTicketTypes = readonly (readonly (string | null)[])[];

/** Service input to lay out reserved seating. */
export interface ConfigureReservedInput {
  name: string;
  rows: number;
  seatsPerRow: number;
  /**
   * Every seat of a row gets the row's entry. Send this or `seatTicketTypes`,
   * not both; with neither, every surviving seat keeps its type and new seats
   * get none. Null reads as omitted.
   */
  rowTicketTypes?: RowTicketTypes | null;
  /** Each seat gets its own entry. */
  seatTicketTypes?: SeatTicketTypes | null;
}

/** Service input to choose general admission with a headcount. */
export interface ConfigureGeneralInput {
  headcount: number;
}

/** What a reserved save reads under its locks before deciding anything. */
export interface ReservedSnapshot {
  /** The map's seats as they stand (none for a new map). */
  seats: SeatRow[];
  /** The event's live ticket types. */
  tiers: SeatTier[];
  /** Seats booked or held right now. */
  occupiedSeatIds: ReadonlySet<number>;
}

/** Existing seats moving to one ticket type (null: to none). */
export interface SeatRetype {
  ticketTypeId: string | null;
  seatIds: number[];
}

/** What a reserved save writes. */
export interface ReservedPlan {
  added: NewSeatPosition[];
  removedSeatIds: number[];
  retyped: SeatRetype[];
  /**
   * Seats per live ticket type when any seat carries a type after the save —
   * the event's quantities then come from its seat map. Null when none does.
   */
  seatsByTier: ReadonlyMap<string, number> | null;
}

/** Decides a reserved save from what it read; throws to refuse it. */
export type ReservedPlanner = (snapshot: ReservedSnapshot) => ReservedPlan;

/** One seat and the ticket type it sells — how the map is read back. */
export interface SeatTypeRow {
  rowLabel: string | null;
  seatNumber: string;
  ticketTypeId: string | null;
}

/** One row of a reserved map and the ticket types its seats sell. */
export interface SeatRowSummary {
  rowLabel: string;
  /** The type every seat of the row sells; null when they differ or have none. */
  ticketTypeId: string | null;
  seats: number;
  /** Each seat's type, in seat-number order (index 0 = seat "1"). */
  seatTicketTypes: (string | null)[];
}
