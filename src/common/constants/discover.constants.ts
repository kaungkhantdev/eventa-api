import { categories, events } from '../../db/schema/index';

/** The discover module's named constants. */

/** An allocation of 0 means unlimited — mirrors `TicketingPolicy`. */
export const UNLIMITED = 0;

/** At/above this share of the allocation sold, the card starts nudging. */
export const SELLING_FAST_RATIO = 0.9;

export const FREE_LABEL = 'Free';

/** Statuses whose event is live to the public — a draft or cancelled one is not. */
export const LIVE_STATUSES = ['planned', 'upcoming', 'live'] as const;

/** Only a public event belongs in the grid; unlisted and private do not. */
export const PUBLIC_VISIBILITY = 'public';

/** The one projection behind every card, so the grid and a saved list agree. */
export const EVENT_CARD_COLUMNS = {
  id: events.id,
  slug: events.slug,
  name: events.name,
  description: events.description,
  type: events.type,
  categoryName: categories.name,
  startAt: events.startAt,
  endAt: events.endAt,
  timezone: events.timezone,
  isOnline: events.isOnline,
  venueName: events.venueName,
  city: events.city,
  coverImage: events.coverImage,
  organizerName: events.organizerName,
};

/** A card grid, not a table — a dozen fills a first screen without a scroll. */
export const DEFAULT_LIMIT = 12;

export const MAX_LIMIT = 48;

export const FIRST_PAGE = 1;

export const MAX_TEXT = 120;
