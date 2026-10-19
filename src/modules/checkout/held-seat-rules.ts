/** What an order's seats are checked against when it is placed (US-DISC-04). */
export interface HeldSeatsCheck {
  /** The seats the order was priced for. */
  pricedSeatIds: readonly number[];
  /** The seats its holds reserve. */
  heldSeatIds: readonly number[];
  /** Each priced seat's ticket type (null on a seat whose row has none). */
  seatTypes: ReadonlyMap<number, string | null>;
  /** The order's ticket type. */
  ticketTypeId: string;
  /** Whether any seat of the event's map has a ticket type (US-EVT-05). */
  mapTyped: boolean;
}

/**
 * A reserved order may only be placed on exactly the seats it was priced for,
 * each one sold under the order's ticket type (`seatSellsUnder`). The seats an
 * order ends up with are its HELD seats (a paid order is seated from its holds
 * when the money lands), while the price comes from the seats the request
 * named — so without this a buyer could hold a VIP seat, name a Normal one,
 * and pay the Normal price for the VIP seat.
 */
export function heldSeatsMatch(check: HeldSeatsCheck): boolean {
  const priced = new Set(check.pricedSeatIds);
  const held = new Set(check.heldSeatIds);
  const sameSeats =
    priced.size === held.size && [...held].every((id) => priced.has(id));
  return sameSeats && [...priced].every((id) => pricedSeatSells(check, id));
}

/**
 * Whether a seat may be sold as `ticketTypeId` (US-EVT-05). A seat with a type
 * sells only as that type. A seat with none sells as any type, but only on a
 * map none of whose seats has a type — one laid out before rows had types.
 * Once rows have types an untyped seat is not on sale: it would sell at
 * whichever price the buyer picked.
 */
export function seatSellsUnder(
  seatType: string | null,
  ticketTypeId: string,
  mapTyped: boolean,
): boolean {
  if (seatType === null) return !mapTyped;
  return seatType === ticketTypeId;
}

function pricedSeatSells(check: HeldSeatsCheck, seatId: number): boolean {
  const type = check.seatTypes.get(seatId);
  if (type === undefined) return false;
  return seatSellsUnder(type, check.ticketTypeId, check.mapTyped);
}
