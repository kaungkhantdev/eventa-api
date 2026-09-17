import type { FeedItem, FeedWindow } from './notification-feed.types';

/**
 * Transfers that reached the bank (US-MSG-03). Implemented by Payouts.
 *
 * Only completed ones. A payout still scheduled or processing has not happened
 * yet, and a feed is a record of what HAS — the payouts screen is where work in
 * flight belongs.
 *
 * Needs `finView`, like every other item with an amount on it.
 */
export abstract class PayoutFeedPort {
  abstract recentPayouts(
    organizationId: number,
    window: FeedWindow,
  ): Promise<FeedItem[]>;
}
