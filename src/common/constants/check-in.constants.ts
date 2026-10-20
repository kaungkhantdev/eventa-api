/** The check-in module's named constants. */

/** A ticket that entitles someone to walk in — the denominator of the rate. */
export const ADMISSIBLE = ['issued', 'checked_in'] as const;

/** Only an event that has actually happened can have a turnout. */
export const HELD_STATUSES = ['live', 'completed'] as const;

export const MINUTES = 60_000;

export const HOURS = 60 * MINUTES;

/** Doors open two hours ahead, so an early queue can be admitted. */
export const CHECKIN_OPENS_BEFORE_START_MS = 2 * HOURS;

/** Latecomers are still admitted for an hour after the event ends. */
export const CHECKIN_GRACE_AFTER_END_MS = 1 * HOURS;

export const AUDIT_TYPE = 'checkin' as const;

export const DOOR_SHUT =
  'Check-in is not open for this event yet — or has already closed.';

export const NEVER_ADMITTED = 'That ticket has not been checked in.';

/** A ticket in one of these states is not entitled to entry. */
export const DENIED_STATUSES = new Set(['void', 'refunded', 'transferred']);

export const DEFAULT_LIMIT = 20;

export const MAX_LIMIT = 100;

export const MAX_SEARCH = 120;

/** Someone is either already inside, or still expected. */
export const ATTENDANCE_STATUSES = ['checked_in', 'expected'] as const;

/**
 * By name reads like a list to work down; by arrival reads like a feed of who
 * just walked in. The queue wants the first, the station the second.
 */
export const ATTENDANCE_SORTS = ['name', 'recent'] as const;

export const MAX_TOKEN = 256;

export const MAX_STATION = 64;
