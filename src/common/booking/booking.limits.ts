/**
 * Platform-wide booking limits — shared by Ticketing (the per-order limit an
 * organizer may set), Registration (the seats one hold may reserve) and the DTOs
 * that validate both. It mirrors the `ck_orders_seats` check constraint in the
 * database, which is the real backstop.
 */

/** A single booking may hold between 1 and this many seats/units. */
export const MAX_SEATS_PER_BOOKING = 8;

/** Prices are set in whole baht; 100 satang = ฿1. */
export const SATANG_PER_BAHT = 100;
