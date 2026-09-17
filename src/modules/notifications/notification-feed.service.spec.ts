import { Permission } from '../../common/decorators/require-permissions.decorator';
import type { PermissionsService } from '../access/permissions.service';
import type { AuthContext } from '../auth/auth.types';
import { NotificationFeedService } from './notification-feed.service';
import type { NotificationReadsRepository } from './notification-reads.repository';
import type { PaymentFeedPort } from './ports/payment-feed.port';
import type { PayoutFeedPort } from './ports/payout-feed.port';
import type { FeedItem, FeedKind } from './ports/notification-feed.types';
import type { RegistrationFeedPort } from './ports/registration-feed.port';

/**
 * The notification feed (US-MSG-03).
 *
 * Nothing here writes a notification: the feed is derived from what already
 * happened. What is tested is the part that is genuinely this module's — what
 * counts as unread, who may see which items, and that the counts describe the
 * whole feed rather than the filter in front of it.
 */

const ORG = 9;
/** Thursday 16 July 2026, 18:00 Bangkok. */
const NOW = new Date('2026-07-16T11:00:00.000Z');

const auth: AuthContext = {
  userId: 'u-1',
  organizationId: ORG,
  sessionId: 's-1',
  persona: 'admin',
};

const item = (
  id: string,
  kind: FeedKind,
  iso: string,
  over: Partial<FeedItem> = {},
): FeedItem => ({
  id,
  kind,
  at: new Date(iso),
  eventId: 'e-1',
  eventName: 'Tech Summit 2026',
  personName: 'Anong Pattana',
  amountSatang: null,
  seats: null,
  reference: null,
  ...over,
});

const REGISTRATION = item(
  'order:1',
  'registration',
  '2026-07-16T09:00:00.000Z',
  {
    seats: 2,
  },
);
const PAYMENT = item('payment:1', 'payment', '2026-07-16T08:00:00.000Z', {
  amountSatang: 125_000,
});
const PAYOUT = item('payout:1', 'payout', '2026-07-15T08:00:00.000Z', {
  amountSatang: 4_829_000,
  personName: null,
  reference: 'PO-2026-07',
});

describe('NotificationFeedService (US-MSG-03)', () => {
  let registrations: jest.Mocked<RegistrationFeedPort>;
  let payments: jest.Mocked<PaymentFeedPort>;
  let payouts: jest.Mocked<PayoutFeedPort>;
  let reads: jest.Mocked<NotificationReadsRepository>;
  let permissions: jest.Mocked<PermissionsService>;
  let service: NotificationFeedService;

  const grantAll = () =>
    (permissions.getFor = jest
      .fn()
      .mockResolvedValue([Permission.regView, Permission.finView]));

  beforeEach(() => {
    registrations = {
      recentRegistrations: jest.fn().mockResolvedValue([REGISTRATION]),
    };
    payments = { recentPayments: jest.fn().mockResolvedValue([PAYMENT]) };
    payouts = { recentPayouts: jest.fn().mockResolvedValue([PAYOUT]) };
    reads = {
      readAtFor: jest.fn().mockResolvedValue(null),
      markReadAt: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<NotificationReadsRepository>;
    permissions = {} as jest.Mocked<PermissionsService>;
    grantAll();
    service = new NotificationFeedService(
      registrations,
      payments,
      payouts,
      reads,
      permissions,
      { now: () => NOW },
    );
  });

  describe('the feed itself', () => {
    it('merges every source into one list, newest first', async () => {
      const view = await service.load(auth, {});
      const ids = view.groups.flatMap((g) => g.items).map((i) => i.id);
      expect(ids).toEqual(['order:1', 'payment:1', 'payout:1']);
    });

    it('groups by recency', async () => {
      const view = await service.load(auth, {});
      expect(view.groups.map((g) => g.bucket)).toEqual(['today', 'yesterday']);
    });

    it('asks every source for the same window', async () => {
      await service.load(auth, {});
      const [, window] = registrations.recentRegistrations.mock.calls[0];
      expect(payments.recentPayments).toHaveBeenCalledWith(ORG, window);
      expect(payouts.recentPayouts).toHaveBeenCalledWith(ORG, window);
    });

    it('answers an empty workspace with no groups rather than an error', async () => {
      registrations.recentRegistrations = jest.fn().mockResolvedValue([]);
      payments.recentPayments = jest.fn().mockResolvedValue([]);
      payouts.recentPayouts = jest.fn().mockResolvedValue([]);

      const view = await service.load(auth, {});
      expect(view.groups).toEqual([]);
      expect(view.counts).toEqual({ all: 0, unread: 0 });
    });
  });

  describe('what counts as unread', () => {
    it('treats everything as unread for a member who has never looked', async () => {
      const view = await service.load(auth, {});
      expect(view.counts).toEqual({ all: 3, unread: 3 });
    });

    it('treats anything since the last look as unread, and the rest as read', async () => {
      // Marked read yesterday evening: today's two are new, the payout is not.
      reads.readAtFor = jest
        .fn()
        .mockResolvedValue(new Date('2026-07-15T12:00:00.000Z'));

      const view = await service.load(auth, {});
      expect(view.counts).toEqual({ all: 3, unread: 2 });
      const unread = view.groups
        .flatMap((g) => g.items)
        .filter((i) => i.unread)
        .map((i) => i.id);
      expect(unread).toEqual(['order:1', 'payment:1']);
    });

    it('does not call an item unread at the very instant it was read', async () => {
      // The watermark is inclusive: marking read at exactly an item's time must
      // not leave that item unread, or "mark all read" could never reach zero.
      reads.readAtFor = jest.fn().mockResolvedValue(REGISTRATION.at);
      registrations.recentRegistrations = jest
        .fn()
        .mockResolvedValue([REGISTRATION]);
      payments.recentPayments = jest.fn().mockResolvedValue([]);
      payouts.recentPayouts = jest.fn().mockResolvedValue([]);

      expect((await service.load(auth, {})).counts.unread).toBe(0);
    });
  });

  describe('the unread filter', () => {
    beforeEach(() => {
      reads.readAtFor = jest
        .fn()
        .mockResolvedValue(new Date('2026-07-15T12:00:00.000Z'));
    });

    it('shows only unread items', async () => {
      const view = await service.load(auth, { unreadOnly: true });
      expect(view.groups.flatMap((g) => g.items).map((i) => i.id)).toEqual([
        'order:1',
        'payment:1',
      ]);
    });

    it('still reports BOTH counts, so the All tab keeps its number', async () => {
      const view = await service.load(auth, { unreadOnly: true });
      expect(view.counts).toEqual({ all: 3, unread: 2 });
    });

    it('returns no groups at all once everything has been read', async () => {
      // What the "you’re all caught up" empty state is rendered from.
      reads.readAtFor = jest.fn().mockResolvedValue(NOW);
      const view = await service.load(auth, { unreadOnly: true });
      expect(view.groups).toEqual([]);
      expect(view.counts.unread).toBe(0);
    });
  });

  describe('who may see what', () => {
    it('never reads money for a member without finance access', async () => {
      // Withheld at the source: not fetched, not filtered out afterwards.
      permissions.getFor = jest.fn().mockResolvedValue([Permission.regView]);

      const view = await service.load(auth, {});
      expect(payments.recentPayments).not.toHaveBeenCalled();
      expect(payouts.recentPayouts).not.toHaveBeenCalled();
      expect(view.groups.flatMap((g) => g.items).map((i) => i.id)).toEqual([
        'order:1',
      ]);
    });

    it('never reads registrations for a member without registration access', async () => {
      permissions.getFor = jest.fn().mockResolvedValue([Permission.finView]);

      const view = await service.load(auth, {});
      expect(registrations.recentRegistrations).not.toHaveBeenCalled();
      expect(view.counts.all).toBe(2);
    });

    it('gives an empty feed to a member entitled to nothing', async () => {
      permissions.getFor = jest.fn().mockResolvedValue([]);
      const view = await service.load(auth, {});
      expect(view.groups).toEqual([]);
      expect(view.counts).toEqual({ all: 0, unread: 0 });
    });

    it('counts unread over what the reader may see, not the workspace', async () => {
      // Otherwise a staff member reads "3 unread" and can only ever find one.
      permissions.getFor = jest.fn().mockResolvedValue([Permission.regView]);
      expect((await service.load(auth, {})).counts).toEqual({
        all: 1,
        unread: 1,
      });
    });
  });

  describe('marking the feed read', () => {
    it('moves the member’s watermark to now', async () => {
      await service.markAllRead(auth);
      expect(reads.markReadAt).toHaveBeenCalledWith(ORG, 'u-1', NOW);
    });

    it('reports nothing unread afterwards', async () => {
      expect(await service.markAllRead(auth)).toEqual({
        readAt: NOW,
        unread: 0,
      });
    });

    it('marks the feed read for THIS member only', async () => {
      // One watermark per member: a colleague clearing theirs must not clear
      // everyone else's.
      await service.markAllRead({ ...auth, userId: 'u-2' });
      expect(reads.markReadAt).toHaveBeenCalledWith(ORG, 'u-2', NOW);
    });
  });
});
