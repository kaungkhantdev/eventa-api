import type { PublicSeatMap } from '../public-pages/ports/public-seat-map.port';
import type {
  SeatMapRow,
  SeatRowSummary,
  SeatTypeRow,
} from './event-seating.types';

/**
 * Each row of the map with every seat's ticket type, rows and seats in number
 * order (labels are "1".."N", so a text sort would read 1, 10, 2). A row has a
 * type of its own only when all its seats carry it; a row split between types
 * reads as none, with each seat's type in `seatTicketTypes` (US-EVT-05).
 */
export function toSeatRows(seats: SeatTypeRow[]): SeatRowSummary[] {
  const rows = new Map<string, SeatTypeRow[]>();
  for (const seat of seats) {
    const rowLabel = seat.rowLabel ?? '';
    const row = rows.get(rowLabel);
    if (row) row.push(seat);
    else rows.set(rowLabel, [seat]);
  }
  return [...rows]
    .map(([rowLabel, rowSeats]) => toSeatRow(rowLabel, rowSeats))
    .sort((a, b) => byNumber(a.rowLabel, b.rowLabel));
}

/** How many rows still have a seat with no ticket type. */
export function unassignedRowCount(rows: SeatRowSummary[]): number {
  return rows.filter((row) => row.seatTicketTypes.includes(null)).length;
}

/** How many seats still have no ticket type. */
export function unassignedSeatCount(rows: SeatRowSummary[]): number {
  return rows.reduce(
    (n, row) => n + row.seatTicketTypes.filter((t) => t === null).length,
    0,
  );
}

/**
 * The public page's view of the map (US-PAGE-05): each row and the types its
 * seats sell, nothing else about them. Null when no seat has a type — such a
 * map says nothing about how the room is split, so the page shows none.
 */
export function toPublicSeatMap(
  layout: SeatMapRow['layout'],
  rows: SeatRowSummary[],
): PublicSeatMap | null {
  if (!rows.some((r) => r.seatTicketTypes.some((t) => t !== null))) {
    return null;
  }
  return {
    seatsPerRow: layout?.seatsPerRow ?? Math.max(...rows.map((r) => r.seats)),
    rows: rows.map((r) => ({
      label: r.rowLabel,
      ticketTypeId: r.ticketTypeId,
      seatTicketTypes: r.seatTicketTypes,
    })),
  };
}

function toSeatRow(rowLabel: string, seats: SeatTypeRow[]): SeatRowSummary {
  const seatTicketTypes = [...seats]
    .sort((a, b) => byNumber(a.seatNumber, b.seatNumber))
    .map((s) => s.ticketTypeId);
  return {
    rowLabel,
    ticketTypeId: sharedType(seatTicketTypes),
    seats: seatTicketTypes.length,
    seatTicketTypes,
  };
}

/** The type every seat carries, or null when they differ (or have none). */
function sharedType(types: (string | null)[]): string | null {
  const [first = null] = types;
  return types.every((t) => t === first) ? first : null;
}

function byNumber(a: string, b: string): number {
  return Number(a) - Number(b) || a.localeCompare(b);
}
