import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import type { SeatsReadiness } from '../events/ports/seating-readiness.port';
import type { SeatTier } from './ports/ticket-quantity.port';
import type {
  ConfigureReservedInput,
  NewSeatPosition,
  ReservedPlan,
  ReservedSnapshot,
  SeatPosition,
  SeatRetype,
  SeatRow,
} from './event-seating.types';

const SOLD = 'sold';

/**
 * Every seat of the grid once the save lands, row by row and seat by seat,
 * with the ticket type it will sell (null for none).
 */
type Layout = NewSeatPosition[];

/**
 * The rules of a reserved seat map split between ticket types seat by seat,
 * whole rows being a shorthand (US-EVT-05). Pure: it decides on what the save
 * read under its locks, so a refusal here rolls the save back before anything
 * is written.
 */
@Injectable()
export class EventSeatingPolicy {
  /**
   * The ticket types, when sent, come as one list or the other: one entry per
   * row, or one per seat of every row (index 0 = row 1, seat 1).
   */
  assertTypeShape(input: ConfigureReservedInput): void {
    const { rowTicketTypes, seatTicketTypes } = input;
    if (rowTicketTypes && seatTicketTypes) {
      throw DomainException.validation(
        'Send rowTicketTypes or seatTicketTypes, not both.',
      );
    }
    assertOnePerRow(input.rows, rowTicketTypes ?? seatTicketTypes);
    seatTicketTypes?.forEach((seats, i) =>
      assertOnePerSeat(i + 1, input.seatsPerRow, seats),
    );
  }

  /**
   * What laying the map out as `input` writes: the seats added (each with its
   * type), the seats removed, the seats moving to another type, and — once any
   * seat carries a type — the seats each live ticket type ends up with.
   * `published` is any event past its draft: its sold seats stay, and so does
   * a type on every seat once any seat has one.
   */
  planReserved(
    snapshot: ReservedSnapshot,
    input: ConfigureReservedInput,
    published: boolean,
  ): ReservedPlan {
    const layout = layoutAfter(snapshot.seats, input);
    this.assertLiveTypes(layout, snapshot.tiers, Boolean(input.rowTicketTypes));
    this.assertEverySeatTyped(layout, published);
    const diff = diffLayout(snapshot.seats, layout);
    this.assertNoSoldSeatRemoved(diff.removed, published);
    return {
      added: diff.added,
      removedSeatIds: diff.removed.map((s) => s.id),
      retyped: this.retypedSeats(diff.kept, layout, snapshot.occupiedSeatIds),
      seatsByTier: seatsByTier(layout, snapshot.tiers),
    };
  }

  /**
   * Where the seats stand against the event's live ticket types. A map none
   * of whose seats has a type yet — one laid out before seats had types — is
   * one gap, its seats, rather than one per ticket type as well.
   */
  readiness(
    seatTypes: readonly (string | null)[],
    tiers: SeatTier[],
  ): SeatsReadiness {
    const seatsWithoutType = seatTypes.filter((t) => t === null).length;
    if (seatTypes.length > 0 && seatsWithoutType === seatTypes.length) {
      return { seatsWithoutType, ticketTypesWithoutSeats: [] };
    }
    const typesWithSeats = new Set(seatTypes);
    return {
      seatsWithoutType,
      ticketTypesWithoutSeats: tiers
        .filter((t) => !typesWithSeats.has(t.id))
        .map((t) => t.name),
    };
  }

  /**
   * Every type must be a live ticket type of this event. A row list names the
   * row, as it was sent; otherwise the seat is named.
   */
  private assertLiveTypes(
    layout: Layout,
    tiers: SeatTier[],
    sentByRow: boolean,
  ): void {
    const live = new Set(tiers.map((t) => t.id));
    const stray = layout.find(
      (s) => s.ticketTypeId !== null && !live.has(s.ticketTypeId),
    );
    if (!stray) return;
    const whose = sentByRow
      ? `Row ${stray.rowLabel}'s`
      : `Row ${stray.rowLabel} seat ${stray.seatNumber}'s`;
    throw DomainException.validation(
      `${whose} ticket type isn't one of this event's ticket types.`,
    );
  }

  /**
   * Once a published event's seats have ticket types, every seat needs one: a
   * seat with none would sell under whichever type the buyer picks, at that
   * type's price (US-EVT-05). A draft may leave seats open until it publishes,
   * and a map none of whose seats has a type still sells as it always has.
   */
  private assertEverySeatTyped(layout: Layout, published: boolean): void {
    if (!published || layout.every((s) => s.ticketTypeId === null)) return;
    const untyped = layout.find((s) => s.ticketTypeId === null);
    if (!untyped) return;
    throw DomainException.validation(
      `Give every seat in row ${untyped.rowLabel} a ticket type. Every seat of a published event needs one.`,
    );
  }

  /** A published event must never lose seats that are already sold. */
  private assertNoSoldSeatRemoved(removed: SeatRow[], block: boolean): void {
    if (!block || !removed.some((s) => s.status === SOLD)) return;
    throw DomainException.validation(
      'Seats that are already sold cannot be removed from a published event.',
    );
  }

  /**
   * The kept seats whose type changes, grouped by the type they move to. A
   * seat booked or held keeps the type it was sold or held under: retyping it
   * would sell one seat twice over, under two prices. Its row's other seats
   * may still move.
   */
  private retypedSeats(
    kept: SeatRow[],
    layout: Layout,
    occupiedSeatIds: ReadonlySet<number>,
  ): SeatRetype[] {
    const typeAt = new Map(layout.map((s) => [positionKey(s), s.ticketTypeId]));
    const typeOf = (s: SeatRow) => typeAt.get(positionKey(s)) ?? null;
    const moving = kept.filter((s) => s.ticketTypeId !== typeOf(s));
    const locked = moving.find((s) => occupiedSeatIds.has(s.id));
    if (locked) {
      throw DomainException.conflict(
        `Row ${locked.rowLabel} seat ${locked.seatNumber} is booked or held, so its ticket type can't change.`,
      );
    }
    return groupByType(moving, typeOf);
  }
}

/** A list sent per row, or per seat of every row, has one entry per row. */
function assertOnePerRow(
  rows: number,
  perRow: readonly unknown[] | null | undefined,
): void {
  if (!perRow || perRow.length === rows) return;
  throw DomainException.validation(
    `Send one ticket type per row: this map has ${rows} rows, but ${perRow.length} were sent.`,
  );
}

/** Each row of a per-seat list has one entry per seat. */
function assertOnePerSeat(
  row: number,
  seatsPerRow: number,
  seats: readonly unknown[],
): void {
  if (seats.length === seatsPerRow) return;
  throw DomainException.validation(
    `Send one ticket type per seat: row ${row} has ${seatsPerRow} seats, but ${seats.length} were sent.`,
  );
}

/**
 * Every seat of the rows × seatsPerRow grid with the type it will sell: the
 * one sent for it (its own, or its row's), or — when nothing is sent — the
 * type it carries now. A new seat gets none.
 */
function layoutAfter(seats: SeatRow[], input: ConfigureReservedInput): Layout {
  const current = new Map(seats.map((s) => [positionKey(s), s.ticketTypeId]));
  return gridPositions(input.rows, input.seatsPerRow).map((p) => {
    const sent = sentTypeAt(input, p);
    const ticketTypeId =
      sent === undefined ? (current.get(positionKey(p)) ?? null) : sent;
    return { ...p, ticketTypeId };
  });
}

/** The type sent for the seat at `p`; undefined when no list was sent. */
function sentTypeAt(
  input: ConfigureReservedInput,
  p: SeatPosition,
): string | null | undefined {
  const row = Number(p.rowLabel) - 1;
  if (input.seatTicketTypes) {
    return input.seatTicketTypes[row]?.[Number(p.seatNumber) - 1];
  }
  return input.rowTicketTypes?.[row];
}

/**
 * Seats per live ticket type once the save lands, 0 for a type with no seats —
 * or null when no seat carries a type, which leaves the quantities typed.
 */
function seatsByTier(
  layout: Layout,
  tiers: SeatTier[],
): ReadonlyMap<string, number> | null {
  if (layout.every((s) => s.ticketTypeId === null)) return null;
  const counts = new Map<string | null, number>();
  for (const { ticketTypeId } of layout) {
    counts.set(ticketTypeId, (counts.get(ticketTypeId) ?? 0) + 1);
  }
  return new Map(tiers.map((t) => [t.id, counts.get(t.id) ?? 0]));
}

/** Seats grouped by the type they move to, groups in order of first seat. */
function groupByType(
  seats: SeatRow[],
  typeOf: (s: SeatRow) => string | null,
): SeatRetype[] {
  const groups = new Map<string | null, number[]>();
  for (const seat of seats) {
    const type = typeOf(seat);
    const ids = groups.get(type);
    if (ids) ids.push(seat.id);
    else groups.set(type, [seat.id]);
  }
  return [...groups].map(([ticketTypeId, seatIds]) => ({
    ticketTypeId,
    seatIds,
  }));
}

/** The existing seats a layout keeps and drops, and the seats it adds. */
function diffLayout(
  seats: SeatRow[],
  layout: Layout,
): { kept: SeatRow[]; removed: SeatRow[]; added: NewSeatPosition[] } {
  const wanted = new Set(layout.map(positionKey));
  const existing = new Set(seats.map(positionKey));
  return {
    kept: seats.filter((s) => wanted.has(positionKey(s))),
    removed: seats.filter((s) => !wanted.has(positionKey(s))),
    added: layout.filter((p) => !existing.has(positionKey(p))),
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
