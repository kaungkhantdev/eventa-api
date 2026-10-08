/**
 * Today's calendar date in Asia/Bangkok, computed inside Postgres.
 *
 * Invoice ageing is judged on the organizer's day, not UTC's (see
 * `invoice-ageing.ts`). The test database session runs in UTC, so a seed that
 * anchors on its own `current_date` disagrees with the API for the seven hours
 * each day when the two are on different dates — the suite then fails between
 * midnight and 07:00 Bangkok and passes the rest of the day. Ask the database
 * for Bangkok's day explicitly so a seeded offset means the same thing to both.
 */
export const BANGKOK_TODAY_SQL = "(now() AT TIME ZONE 'Asia/Bangkok')::date";
