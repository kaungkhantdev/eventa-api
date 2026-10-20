/** The public-pages module's named constants. */

/** Statuses whose page is live to the public — a draft or cancelled event is not. */
export const LIVE_STATUSES = ['planned', 'upcoming', 'live'] as const;

/** Only a public event is reachable by link; unlisted/private are not. */
export const PUBLIC_VISIBILITY = 'public';

/** Below this many remaining, the tier shows an urgency line (US-PAGE-05). */
export const LOW_STOCK_THRESHOLD = 10;

/** Used when the organizer set no accent colour, or set an unusable one. */
export const DEFAULT_ACCENT = '#2563EB';

export const ACCENT_PATTERN = /^#[0-9a-f]{6}$/i;

export const DEFAULT_TEMPLATE = 'aurora';

export const DEFAULT_AGENDA_TITLE = 'Agenda';

export const DEFAULT_SPEAKERS_TITLE = 'Speakers';

/** Tier states that are not purchasable. */
export const UNAVAILABLE_STATUSES = ['paused', 'soldout'];

/** Only reserved seating has rows to split between the tickets (US-EVT-05). */
export const RESERVED_SEATING = 'reserved';
