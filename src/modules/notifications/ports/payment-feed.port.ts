import type { FeedItem, FeedWindow } from './notification-feed.types';

/**
 * Money arriving, and money refusing to (US-MSG-03). Implemented by Payments.
 *
 * One method for both, because they come from the same table and the same scan:
 * a settled payment is a `payment` item, a declined one is an `alert`. Which is
 * which is Payments' call, not the feed's.
 *
 * Needs `finView` — US-MSG-03's own note that payment items appear only for
 * members with finance access. The service checks before calling.
 */
export abstract class PaymentFeedPort {
  abstract recentPayments(
    organizationId: number,
    window: FeedWindow,
  ): Promise<FeedItem[]>;
}
