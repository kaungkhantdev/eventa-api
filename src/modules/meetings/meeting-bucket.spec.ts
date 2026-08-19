import { bucketFor, isJoinable, startsAt } from './meeting-bucket';

/** 16:00 Bangkok on 7 Aug 2026 — mid-afternoon, so "today" is unambiguous. */
const NOW = new Date('2026-08-07T09:00:00Z');
const TODAY = '2026-08-07';

describe('Meeting buckets (US-MTG-01)', () => {
  it('puts a meeting dated today in Today', () => {
    expect(bucketFor(TODAY, NOW)).toBe('today');
  });

  it('puts a later date in Upcoming', () => {
    expect(bucketFor('2026-08-08', NOW)).toBe('upcoming');
  });

  it('puts an earlier date in Past', () => {
    expect(bucketFor('2026-08-06', NOW)).toBe('past');
  });

  describe('the day is BANGKOK’s, not the server’s', () => {
    it('still says today at 23:59 Bangkok, which is 16:59 UTC', () => {
      expect(bucketFor(TODAY, new Date('2026-08-07T16:59:59Z'))).toBe('today');
    });

    it('rolls to past at 00:00 Bangkok, which is 17:00 UTC the day before', () => {
      // The case a naive UTC comparison gets wrong for seven hours every day.
      expect(bucketFor(TODAY, new Date('2026-08-07T17:00:00Z'))).toBe('past');
    });

    it('says today from 00:00 Bangkok on the day itself', () => {
      expect(bucketFor(TODAY, new Date('2026-08-06T17:00:00Z'))).toBe('today');
    });

    it('is still upcoming at 23:59 Bangkok the night before', () => {
      expect(bucketFor('2026-08-08', new Date('2026-08-07T16:59:00Z'))).toBe(
        'upcoming',
      );
    });
  });
});

describe('Meeting start instants (US-MTG-01/03)', () => {
  it('reads a Bangkok wall clock as the UTC instant it actually is', () => {
    // 09:00 in Bangkok is 02:00 UTC. Stored as wall clock, compared as instant.
    expect(startsAt(TODAY, '09:00').toISOString()).toBe(
      '2026-08-07T02:00:00.000Z',
    );
  });

  it('handles a seconds-bearing time from Postgres', () => {
    expect(startsAt(TODAY, '09:30:00').toISOString()).toBe(
      '2026-08-07T02:30:00.000Z',
    );
  });

  it('orders same-day meetings by their start', () => {
    const nine = startsAt(TODAY, '09:00').getTime();
    const ten = startsAt(TODAY, '10:00').getTime();
    expect(nine).toBeLessThan(ten);
  });
});

describe('Joining a video meeting (US-MTG-07)', () => {
  const video = { mode: 'Video' as const, link: 'https://meet.example/abc' };

  it('offers Join for a video meeting today with a ready link', () => {
    expect(isJoinable({ ...video, date: TODAY }, NOW)).toBe(true);
  });

  it('offers Join for an upcoming video meeting', () => {
    expect(isJoinable({ ...video, date: '2026-08-09' }, NOW)).toBe(true);
  });

  it('offers no Join for a PAST video meeting', () => {
    expect(isJoinable({ ...video, date: '2026-08-01' }, NOW)).toBe(false);
  });

  it('offers no Join while the link is not ready yet', () => {
    // The calendar sync has not produced a Meet link — the story wants Join
    // unavailable with a hint, not a button that goes nowhere.
    expect(isJoinable({ mode: 'Video', link: null, date: TODAY }, NOW)).toBe(
      false,
    );
  });

  it.each(['In person', 'Phone'] as const)(
    'offers no Join for a %s meeting',
    (mode) => {
      expect(isJoinable({ mode, link: null, date: TODAY }, NOW)).toBe(false);
    },
  );
});
