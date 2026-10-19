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

/** A seat to add, with the ticket type its row sells (null for none). */
export interface NewSeatPosition extends SeatPosition {
  ticketTypeId: string | null;
}

/**
 * Each row's ticket type, index 0 = row "1"; null is a row with no type
 * (US-EVT-05).
 */
export type RowTicketTypes = readonly (string | null)[];

/** Service input to lay out reserved seating. */
export interface ConfigureReservedInput {
  name: string;
  rows: number;
  seatsPerRow: number;
  /** Omitted: every surviving row keeps its type and new rows get none. */
  rowTicketTypes?: RowTicketTypes;
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

/** The seats of one row moving to another ticket type. */
export interface RowRetype {
  ticketTypeId: string | null;
  seatIds: number[];
}

/** What a reserved save writes. */
export interface ReservedPlan {
  added: NewSeatPosition[];
  removedSeatIds: number[];
  retyped: RowRetype[];
  /**
   * Seats per live ticket type when any seat carries a type after the save —
   * the event's quantities then come from its seat map. Null when none does.
   */
  seatsByTier: ReadonlyMap<string, number> | null;
}

/** Decides a reserved save from what it read; throws to refuse it. */
export type ReservedPlanner = (snapshot: ReservedSnapshot) => ReservedPlan;

/** Seats of one row with one ticket type — how the map is read back. */
export interface RowTypeCount {
  rowLabel: string | null;
  ticketTypeId: string | null;
  seats: number;
}

/** One row of a reserved map and the ticket type it sells. */
export interface SeatRowSummary {
  rowLabel: string;
  ticketTypeId: string | null;
  seats: number;
}
