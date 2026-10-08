import { groupByRecency } from './notification-grouping';
import type { FeedItem } from './ports/notification-feed.types';

/**
 * Grouping the feed by recency (US-MSG-03).
 *
 * Every boundary is a BANGKOK calendar boundary, so an item at 23:00 local is
 * "today" even though UTC has already moved on. Weeks open on Monday.
 */

const at = (iso: string): FeedItem => ({
  id: `n-${iso}`,
  kind: 'registration',
  at: new Date(iso),
  eventId: null,
  eventName: null,
  personName: null,
  amountSatang: null,
  seats: null,
  reference: null,
});

/** Thursday 16 July 2026, 18:00 Bangkok. */
const NOW = new Date('2026-07-16T11:00:00.000Z');

const bucketsOf = (items: FeedItem[]) =>
  groupByRecency(items, NOW).map((g) => g.bucket);

describe('groupByRecency', () => {
  it('puts this evening’s item in today', () => {
    expect(bucketsOf([at('2026-07-16T02:00:00.000Z')])).toEqual(['today']);
  });

  it('keeps a late-night item on its Bangkok day, not the next UTC one', () => {
    // 23:30 Bangkok on the 16th is 16:30 UTC — still "today" to the organizer.
    expect(bucketsOf([at('2026-07-16T16:30:00.000Z')])).toEqual(['today']);
  });

  it('separates yesterday from today', () => {
    expect(
      bucketsOf([
        at('2026-07-16T02:00:00.000Z'),
        at('2026-07-15T02:00:00.000Z'),
      ]),
    ).toEqual(['today', 'yesterday']);
  });

  it('gathers the rest of this week behind yesterday', () => {
    // Monday the 13th, in the same week as Thursday the 16th.
    expect(bucketsOf([at('2026-07-13T02:00:00.000Z')])).toEqual([
      'earlierThisWeek',
    ]);
  });

  it('puts the week before in last week', () => {
    // Friday the 10th — the previous Monday-to-Sunday week.
    expect(bucketsOf([at('2026-07-10T02:00:00.000Z')])).toEqual(['lastWeek']);
  });

  it('puts anything older in earlier', () => {
    expect(bucketsOf([at('2026-06-20T02:00:00.000Z')])).toEqual(['earlier']);
  });

  it('shows this week’s groups by default and hides the older ones', () => {
    // The kit reveals the last two behind "Show older activity".
    const groups = groupByRecency(
      [
        at('2026-07-16T02:00:00.000Z'),
        at('2026-07-15T02:00:00.000Z'),
        at('2026-07-13T02:00:00.000Z'),
        at('2026-07-10T02:00:00.000Z'),
        at('2026-06-20T02:00:00.000Z'),
      ],
      NOW,
    );
    expect(groups.map((g) => g.recent)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it('leaves out a group with nothing in it', () => {
    expect(bucketsOf([at('2026-07-16T02:00:00.000Z')])).not.toContain(
      'yesterday',
    );
  });

  it('orders items inside a group newest first', () => {
    const [group] = groupByRecency(
      [at('2026-07-16T02:00:00.000Z'), at('2026-07-16T09:00:00.000Z')],
      NOW,
    );
    expect(group.items.map((i) => i.at.toISOString())).toEqual([
      '2026-07-16T09:00:00.000Z',
      '2026-07-16T02:00:00.000Z',
    ]);
  });

  describe('when today is a Monday', () => {
    /** Monday 20 July 2026, 17:00 Bangkok. */
    const MONDAY = new Date('2026-07-20T10:00:00.000Z');

    it('still calls Sunday yesterday, although it fell in last week', () => {
      // Named-day beats week arithmetic: nobody reads Sunday as "last week" on
      // a Monday morning.
      const groups = groupByRecency([at('2026-07-19T02:00:00.000Z')], MONDAY);
      expect(groups[0].bucket).toBe('yesterday');
    });

    it('puts Saturday in last week', () => {
      const groups = groupByRecency([at('2026-07-18T02:00:00.000Z')], MONDAY);
      expect(groups[0].bucket).toBe('lastWeek');
    });
  });

  it('returns nothing at all for an empty feed', () => {
    expect(groupByRecency([], NOW)).toEqual([]);
  });
});
