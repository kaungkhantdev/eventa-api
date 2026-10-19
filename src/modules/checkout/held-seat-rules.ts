/** What an order's seats are checked against when it is placed (US-DISC-04). */
export interface HeldSeatsCheck {
  /** The seats the order was priced for. */
  pricedSeatIds: readonly number[];
  /** The seats its holds reserve. */
  heldSeatIds: readonly number[];
  /** Each priced seat's ticket type (null on a map from before rows had types). */
  seatTypes: ReadonlyMap<number, string | null>;
  /** The order's ticket type. */
  ticketTypeId: string;
}

/**
 * A reserved order may only be placed on exactly the seats it was priced for,
 * each one of its own ticket type or of none. The seats an order ends up with
 * are its HELD seats (a paid order is seated from its holds when the money
 * lands), while the price comes from the seats the request named — so without
 * this a buyer could hold a VIP seat, name a Normal one, and pay the Normal
 * price for the VIP seat.
 */
export function heldSeatsMatch(check: HeldSeatsCheck): boolean {
  const priced = new Set(check.pricedSeatIds);
  const held = new Set(check.heldSeatIds);
  const sameSeats =
    priced.size === held.size && [...held].every((id) => priced.has(id));
  return sameSeats && [...priced].every((id) => sellsUnder(check, id));
}

function sellsUnder(check: HeldSeatsCheck, seatId: number): boolean {
  const type = check.seatTypes.get(seatId);
  if (type === undefined) return false;
  return type === null || type === check.ticketTypeId;
}
