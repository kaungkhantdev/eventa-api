import type { PublicSeatMap } from '../public-pages/ports/public-seat-map.port';
import type {
  RowTypeCount,
  SeatMapRow,
  SeatRowSummary,
} from './event-seating.types';

/**
 * Each row of the map with its ticket type and seat count, rows in number order
 * (row labels are "1".."N", so a text sort would read 1, 10, 2). A row is a
 * type's only when all its seats carry it; a row split across types reads as
 * having none, so it is flagged rather than half-sold under either.
 */
export function toSeatRows(counts: RowTypeCount[]): SeatRowSummary[] {
  const rows = new Map<string, SeatRowSummary>();
  for (const count of counts) {
    const rowLabel = count.rowLabel ?? '';
    const row = rows.get(rowLabel);
    if (!row) {
      rows.set(rowLabel, { rowLabel, ...pick(count) });
      continue;
    }
    row.seats += count.seats;
    if (row.ticketTypeId !== count.ticketTypeId) row.ticketTypeId = null;
  }
  return [...rows.values()].sort(byRowNumber);
}

/** How many rows still have no ticket type. */
export function unassignedRowCount(rows: SeatRowSummary[]): number {
  return rows.filter((row) => row.ticketTypeId === null).length;
}

/**
 * The public page's view of the map (US-PAGE-05): each row and the type it
 * sells, nothing about its seats. Null when no row has a type — such a map
 * says nothing about how the room is split, so the page shows none.
 */
export function toPublicSeatMap(
  layout: SeatMapRow['layout'],
  rows: SeatRowSummary[],
): PublicSeatMap | null {
  if (rows.every((row) => row.ticketTypeId === null)) return null;
  return {
    seatsPerRow: layout?.seatsPerRow ?? Math.max(...rows.map((r) => r.seats)),
    rows: rows.map((r) => ({
      label: r.rowLabel,
      ticketTypeId: r.ticketTypeId,
    })),
  };
}

function pick(count: RowTypeCount): Omit<SeatRowSummary, 'rowLabel'> {
  return { ticketTypeId: count.ticketTypeId, seats: count.seats };
}

function byRowNumber(a: SeatRowSummary, b: SeatRowSummary): number {
  return (
    Number(a.rowLabel) - Number(b.rowLabel) ||
    a.rowLabel.localeCompare(b.rowLabel)
  );
}
