import type { FeedItem, FeedWindow } from './notification-feed.types';

/**
 * What the feed needs to know about new registrations, without reading the
 * orders tables (US-MSG-03).
 *
 * Declared here by the consumer and implemented by RegistrationStats, the module
 * that already owns the registration read model — the same arrangement the
 * reports use. The feed reads four contexts; if it queried their tables itself
 * it would be the one module in the codebase allowed to.
 *
 * Needs `regView`. The service checks before calling, so an unauthorized
 * reader's registrations are never loaded rather than merely hidden.
 */
export abstract class RegistrationFeedPort {
  abstract recentRegistrations(
    organizationId: number,
    window: FeedWindow,
  ): Promise<FeedItem[]>;
}
