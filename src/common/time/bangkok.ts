/** Asia/Bangkok is a fixed UTC+7 (no DST) — safe to model as a constant offset. */
export const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** The Bangkok calendar-day number for a UTC instant (days since epoch, +7h). */
export function bangkokDay(instant: Date): number {
  return Math.floor((instant.getTime() + BANGKOK_OFFSET_MS) / DAY_MS);
}

/** Whole Bangkok days from `now` until `target`, floored at 0 (days-left). */
export function daysLeft(now: Date, target: Date): number {
  return Math.max(0, bangkokDay(target) - bangkokDay(now));
}
