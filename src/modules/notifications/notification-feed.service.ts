import { Injectable } from '@nestjs/common';
import { Permission } from '../../common/decorators/require-permissions.decorator';
import { DAY_MS } from '../../common/time/bangkok';
import { Clock } from '../../common/time/clock';
import { PermissionsService } from '../access/permissions.service';
import type { AuthContext } from '../auth/auth.types';
import type { NotificationFeedQueryDto } from './dto/notification-feed.query.dto';
import { groupByRecency, type FeedGroup } from './notification-grouping';
import { NotificationReadsRepository } from './notification-reads.repository';
import { PaymentFeedPort } from './ports/payment-feed.port';
import { PayoutFeedPort } from './ports/payout-feed.port';
import type { FeedItem, FeedWindow } from './ports/notification-feed.types';
import { RegistrationFeedPort } from './ports/registration-feed.port';

/**
 * Triage everything happening across the workspace in one feed (US-MSG-03).
 *
 * The feed is DERIVED, not stored. Every item is something that already exists —
 * a registration, a payment, a decline, a payout — read through a port from the
 * module that owns it. Nothing is written when those things happen, so there is
 * no second copy of the truth to drift, nothing to backfill, and an item can
 * never survive the thing it describes being deleted.
 *
 * What IS stored is one timestamp per member: how far they have read. "Mark all
 * read" moves it, and unread is everything after it. That is the whole of the
 * read model, and it is why the unread count survives a reload.
 */

/** How far back the feed looks. Older activity belongs to the modules' own screens. */
export const FEED_WINDOW_DAYS = 30;
/** The most items the feed will carry, newest first. */
export const FEED_LIMIT = 100;

export interface FeedItemView extends FeedItem {
  unread: boolean;
}

export interface FeedCounts {
  /** Everything in the window the reader is entitled to see. */
  all: number;
  unread: number;
}

export interface NotificationFeedView {
  counts: FeedCounts;
  groups: FeedGroup<FeedItemView>[];
  /** When this member last marked the feed read; null if they never have. */
  readAt: Date | null;
}

@Injectable()
export class NotificationFeedService {
  constructor(
    private readonly registrations: RegistrationFeedPort,
    private readonly payments: PaymentFeedPort,
    private readonly payouts: PayoutFeedPort,
    private readonly reads: NotificationReadsRepository,
    private readonly permissions: PermissionsService,
    private readonly clock: Clock,
  ) {}

  async load(
    auth: AuthContext,
    query: NotificationFeedQueryDto,
  ): Promise<NotificationFeedView> {
    const now = this.clock.now();
    const window: FeedWindow = {
      since: new Date(now.getTime() - FEED_WINDOW_DAYS * DAY_MS),
      limit: FEED_LIMIT,
    };
    const org = auth.organizationId;
    const granted = await this.permissions.getFor(org, auth.userId);
    // US-MSG-03's note: a member sees only what they are entitled to. Checked
    // before the fetch, so an unentitled reader's items are never loaded.
    const maySee = {
      registrations: granted.includes(Permission.regView),
      money: granted.includes(Permission.finView),
    };

    const [signUps, money, transfers, readAt] = await Promise.all([
      maySee.registrations
        ? this.registrations.recentRegistrations(org, window)
        : [],
      maySee.money ? this.payments.recentPayments(org, window) : [],
      maySee.money ? this.payouts.recentPayouts(org, window) : [],
      this.reads.readAtFor(org, auth.userId),
    ]);

    const items = newestFirst([...signUps, ...money, ...transfers])
      .slice(0, FEED_LIMIT)
      .map((item) => ({ ...item, unread: isUnread(item, readAt) }));

    return {
      // Counted over the whole feed, never over the filter: the All tab has to
      // keep its number while the reader is looking at Unread.
      counts: {
        all: items.length,
        unread: items.filter((i) => i.unread).length,
      },
      groups: groupByRecency(
        query.unreadOnly ? items.filter((i) => i.unread) : items,
        now,
      ),
      readAt,
    };
  }

  /**
   * Mark everything read, up to this instant.
   *
   * Per member, not per workspace — a colleague clearing their own feed must not
   * clear everyone else's. Anything that arrives after this call is unread
   * again, which is what makes the feed worth opening twice.
   */
  async markAllRead(auth: AuthContext): Promise<{ readAt: Date; unread: 0 }> {
    const readAt = this.clock.now();
    await this.reads.markReadAt(auth.organizationId, auth.userId, readAt);
    return { readAt, unread: 0 };
  }
}

function newestFirst(items: FeedItem[]): FeedItem[] {
  return [...items].sort((a, b) => b.at.getTime() - a.at.getTime());
}

/**
 * Inclusive at the watermark: an item stamped at exactly the instant the feed
 * was marked read is read. Otherwise "mark all read" could leave the newest item
 * unread and the count would never reach zero.
 */
function isUnread(item: FeedItem, readAt: Date | null): boolean {
  return readAt === null || item.at.getTime() > readAt.getTime();
}
