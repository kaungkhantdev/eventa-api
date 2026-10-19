import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import type { SeatRowsReadiness } from '../events/ports/seating-readiness.port';
import type { SeatTier } from './ports/ticket-quantity.port';
import type {
  ConfigureReservedInput,
  NewSeatPosition,
  ReservedPlan,
  ReservedSnapshot,
  RowRetype,
  RowTicketTypes,
  SeatPosition,
  SeatRow,
  SeatRowSummary,
} from './event-seating.types';

const SOLD = 'sold';

/** Each row's ticket type after the save, keyed by row label ("1".."N"). */
type RowTypes = Map<string, string | null>;

/**
 * The rules of a reserved seat map split between ticket types by whole rows
 * (US-EVT-05). Pure: it decides on what the save read under its locks, so a
 * refusal here rolls the save back before anything is written.
 */
@Injectable()
export class EventSeatingPolicy {
  /** A row list, when sent, has exactly one entry per row (index 0 = row 1). */
  assertOneTypePerRow(rows: number, rowTicketTypes?: RowTicketTypes): void {
    if (rowTicketTypes === undefined || rowTicketTypes.length === rows) return;
    throw DomainException.validation(
      `Send one ticket type per row: this map has ${rows} rows, but ${rowTicketTypes.length} were sent.`,
    );
  }

  /**
   * What laying the map out as `input` writes: the seats added (each with its
   * row's type), the seats removed, the rows moving to another type, and — once
   * any seat carries a type — the seats each live ticket type ends up with.
   */
  planReserved(
    snapshot: ReservedSnapshot,
    input: ConfigureReservedInput,
    blockSoldRemoval: boolean,
  ): ReservedPlan {
    const rowTypes = this.rowTypesAfter(snapshot.seats, input);
    this.assertLiveTypes(rowTypes, snapshot.tiers);
    const grid = diffGrid(snapshot.seats, input.rows, input.seatsPerRow);
    this.assertNoSoldSeatRemoved(grid.removed, blockSoldRemoval);
    const retyped = this.retypedRows(grid.kept, rowTypes, snapshot);
    const added = grid.added.map((p) => ({
      ...p,
      ticketTypeId: rowTypes.get(p.rowLabel) ?? null,
    }));
    return {
      added,
      removedSeatIds: grid.removed.map((s) => s.id),
      retyped,
      seatsByTier: seatsByTier(grid.kept, added, rowTypes, snapshot.tiers),
    };
  }

  /**
   * Where the rows stand against the event's live ticket types. A map none of
   * whose rows has a type yet — one laid out before rows had types — is one
   * gap, its rows, rather than one per ticket type as well.
   */
  readiness(rows: SeatRowSummary[], tiers: SeatTier[]): SeatRowsReadiness {
    const rowsWithoutType = rows.filter((r) => r.ticketTypeId === null).length;
    if (rows.length > 0 && rowsWithoutType === rows.length) {
      return { rowsWithoutType, ticketTypesWithoutRows: [] };
    }
    const typesWithRows = new Set(rows.map((r) => r.ticketTypeId));
    return {
      rowsWithoutType,
      ticketTypesWithoutRows: tiers
        .filter((t) => !typesWithRows.has(t.id))
        .map((t) => t.name),
    };
  }

  /**
   * The type each row will sell: the one sent for it, or — when no list is
   * sent — the type its seats already carry (a new row gets none).
   */
  private rowTypesAfter(
    seats: SeatRow[],
    input: ConfigureReservedInput,
  ): RowTypes {
    const current = currentRowTypes(seats);
    const types: RowTypes = new Map();
    for (let row = 1; row <= input.rows; row += 1) {
      const label = String(row);
      const sent = input.rowTicketTypes?.[row - 1];
      types.set(
        label,
        sent !== undefined ? sent : (current.get(label) ?? null),
      );
    }
    return types;
  }

  /** Every type sent must be a live ticket type of this event. */
  private assertLiveTypes(rowTypes: RowTypes, tiers: SeatTier[]): void {
    const live = new Set(tiers.map((t) => t.id));
    for (const [row, type] of rowTypes) {
      if (type === null || live.has(type)) continue;
      throw DomainException.validation(
        `Row ${row}'s ticket type isn't one of this event's ticket types.`,
      );
    }
  }

  /** A published event must never lose seats that are already sold. */
  private assertNoSoldSeatRemoved(removed: SeatRow[], block: boolean): void {
    if (!block || !removed.some((s) => s.status === SOLD)) return;
    throw DomainException.validation(
      'Seats that are already sold cannot be removed from a published event.',
    );
  }

  /**
   * The rows whose kept seats change type. A row with any seat booked or held —
   * counting seats this save removes — keeps the type it was sold or held
   * under: retyping it would sell one seat twice over, under two prices.
   */
  private retypedRows(
    kept: SeatRow[],
    rowTypes: RowTypes,
    snapshot: ReservedSnapshot,
  ): RowRetype[] {
    const rowsBefore = groupByRow(snapshot.seats);
    const retyped: RowRetype[] = [];
    for (const [row, seats] of groupByRow(kept)) {
      const ticketTypeId = rowTypes.get(row) ?? null;
      if (seats.every((s) => s.ticketTypeId === ticketTypeId)) continue;
      const before = rowsBefore.get(row) ?? seats;
      if (before.some((s) => snapshot.occupiedSeatIds.has(s.id))) {
        throw DomainException.conflict(
          `Row ${row} has booked or held seats, so its ticket type can't change.`,
        );
      }
      retyped.push({ ticketTypeId, seatIds: seats.map((s) => s.id) });
    }
    return retyped;
  }
}

/**
 * Seats per live ticket type once the save lands, 0 for a type with no rows —
 * or null when no seat carries a type, which leaves the quantities typed.
 */
function seatsByTier(
  kept: SeatRow[],
  added: NewSeatPosition[],
  rowTypes: RowTypes,
  tiers: SeatTier[],
): ReadonlyMap<string, number> | null {
  const types = [
    ...kept.map((s) => rowTypes.get(s.rowLabel ?? '') ?? null),
    ...added.map((s) => s.ticketTypeId),
  ];
  if (types.every((t) => t === null)) return null;
  return new Map(
    tiers.map((t) => [t.id, types.filter((id) => id === t.id).length]),
  );
}

/** The type each existing row's seats carry (its first seat answers for it). */
function currentRowTypes(seats: SeatRow[]): Map<string, string | null> {
  const types = new Map<string, string | null>();
  for (const [row, rowSeats] of groupByRow(seats)) {
    types.set(row, rowSeats[0].ticketTypeId);
  }
  return types;
}

/** Seats grouped by row label, rows in the order they first appear. */
function groupByRow(seats: SeatRow[]): Map<string, SeatRow[]> {
  const rows = new Map<string, SeatRow[]>();
  for (const seat of seats) {
    const row = seat.rowLabel ?? '';
    const list = rows.get(row);
    if (list) list.push(seat);
    else rows.set(row, [seat]);
  }
  return rows;
}

/** The existing seats a rows × seatsPerRow grid keeps and drops, and what it adds. */
function diffGrid(
  seats: SeatRow[],
  rows: number,
  seatsPerRow: number,
): { kept: SeatRow[]; removed: SeatRow[]; added: SeatPosition[] } {
  const desired = gridPositions(rows, seatsPerRow);
  const desiredKeys = new Set(desired.map(positionKey));
  const existingKeys = new Set(seats.map(positionKey));
  return {
    kept: seats.filter((s) => desiredKeys.has(positionKey(s))),
    removed: seats.filter((s) => !desiredKeys.has(positionKey(s))),
    added: desired.filter((p) => !existingKeys.has(positionKey(p))),
  };
}

/** Every seat position for a rows × seatsPerRow grid (row/seat are 1-based). */
function gridPositions(rows: number, seatsPerRow: number): SeatPosition[] {
  const positions: SeatPosition[] = [];
  for (let r = 1; r <= rows; r += 1) {
    for (let s = 1; s <= seatsPerRow; s += 1) {
      // section is '' (never null) so uq_seats_position actually enforces
      // uniqueness — a NULL would make Postgres treat every seat as distinct.
      positions.push({
        section: '',
        rowLabel: String(r),
        seatNumber: String(s),
      });
    }
  }
  return positions;
}

/** Stable identity of a seat position (for diffing existing seats vs desired). */
function positionKey(p: SeatPosition | SeatRow): string {
  return `${p.section ?? ''}|${p.rowLabel ?? ''}|${p.seatNumber}`;
}
