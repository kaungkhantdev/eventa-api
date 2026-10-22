/** The notifications module's named constants. */

/** How far back the feed looks. Older activity belongs to the modules' own screens. */
export const FEED_WINDOW_DAYS = 30;

/** The most items the feed will carry, newest first. */
export const FEED_LIMIT = 100;

export const FEED_BUCKETS = [
  'today',
  'yesterday',
  'earlierThisWeek',
  'lastWeek',
  'earlier',
] as const;

/**
 * The four kinds the feed can derive today, named as the workspace's existing
 * `notification_kind` vocabulary so a feed item and a notification PREFERENCE
 * mean the same word by the same name.
 *
 * `alert` is a payment that was declined — the demo kit's own classification,
 * and the only one of the four that asks the organizer to do something.
 */
export const FEED_KINDS = [
  'registration',
  'payment',
  'payout',
  'alert',
] as const;
