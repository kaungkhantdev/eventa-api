import type { seatMaps, seats } from '../../../db/schema';

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

/** Service input to lay out reserved seating. */
export interface ConfigureReservedInput {
  name: string;
  rows: number;
  seatsPerRow: number;
}

/** Service input to choose general admission with a headcount. */
export interface ConfigureGeneralInput {
  headcount: number;
}
