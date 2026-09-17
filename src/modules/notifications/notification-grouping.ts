import { bangkokDay } from '../../common/time/bangkok';
import type { FeedItem } from './ports/notification-feed.types';

/**
 * The feed, grouped by recency (US-MSG-03).
 *
 * Buckets rather than labels: the feed is bilingual EN/TH, so "Today" is a word
 * the reader's own language supplies. What the API decides is which bucket an
 * item falls in, which is calendar arithmetic and belongs in one tested place.
 *
 * `recent` is the kit's own division — the first three groups are open, the
 * older two sit behind "Show older activity".
 */

export const FEED_BUCKETS = [
  'today',
  'yesterday',
  'earlierThisWeek',
  'lastWeek',
  'earlier',
] as const;
export type FeedBucket = (typeof FEED_BUCKETS)[number];

/** The buckets that render expanded. */
const RECENT: ReadonlySet<FeedBucket> = new Set<FeedBucket>([
  'today',
  'yesterday',
  'earlierThisWeek',
]);

export interface FeedGroup<T> {
  bucket: FeedBucket;
  /** Whether the group is open by default, or behind "show older". */
  recent: boolean;
  items: T[];
}

/**
 * Generic over the item so the service can attach "unread" to each one BEFORE
 * grouping: the alternative is grouping twice, or grouping a shape that has to
 * be widened afterwards.
 */
export function groupByRecency<T extends Pick<FeedItem, 'at'>>(
  items: T[],
  now: Date,
): FeedGroup<T>[] {
  const today = bangkokDay(now);
  const byBucket = new Map<FeedBucket, T[]>();
  // Newest first, once, so every group is ordered without sorting each.
  for (const item of [...items].sort((a, b) => +b.at - +a.at)) {
    const bucket = bucketOf(bangkokDay(item.at), today);
    byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), item]);
  }
  return FEED_BUCKETS.filter((bucket) => byBucket.has(bucket)).map(
    (bucket) => ({
      bucket,
      recent: RECENT.has(bucket),
      items: byBucket.get(bucket) ?? [],
    }),
  );
}

/**
 * Which bucket a Bangkok day falls in, read from today.
 *
 * Today and yesterday are checked FIRST, and deliberately beat the week
 * arithmetic: on a Monday, Sunday belongs to the week before, but nobody reads
 * yesterday as "last week".
 */
function bucketOf(day: number, today: number): FeedBucket {
  if (day >= today) return 'today';
  if (day === today - 1) return 'yesterday';
  const weeksBack = weekOf(today) - weekOf(day);
  if (weeksBack === 0) return 'earlierThisWeek';
  if (weeksBack === 1) return 'lastWeek';
  return 'earlier';
}

/**
 * The Monday-opening week a day belongs to, counted from the epoch.
 *
 * 1 January 1970 was a Thursday, so shifting by three puts a Monday at the
 * start of each block of seven.
 */
function weekOf(day: number): number {
  return Math.floor((day + 3) / 7);
}
