import {
  bucketRevenue,
  granularityFor,
  type NetRevenueDay,
} from './revenue-trend';

/**
 * The overview's revenue chart (US-RPT-01).
 *
 * Bangkok calendar days in, chart buckets out. Everything here is string date
 * arithmetic on days the database already truncated to Bangkok time, so none of
 * it depends on the machine's timezone.
 */

const day = (d: string, netSatang: number): NetRevenueDay => ({
  day: d,
  netSatang,
});

/** The window as the service passes it: Bangkok midnights, `to` exclusive. */
const window = (from: string, toExclusive: string) => ({
  from: new Date(`${from}T00:00:00.000+07:00`),
  to: new Date(`${toExclusive}T00:00:00.000+07:00`),
});

describe('granularityFor', () => {
  it('plots a week and a month day by day', () => {
    expect(granularityFor(7)).toBe('day');
    expect(granularityFor(30)).toBe('day');
  });

  it('plots a quarter by week', () => {
    // 90 daily bars is a smear; 13 weekly ones is a trend.
    expect(granularityFor(90)).toBe('week');
  });

  it('plots a year by month', () => {
    expect(granularityFor(365)).toBe('month');
  });

  it('plots the longest allowed span by month', () => {
    expect(granularityFor(731)).toBe('month');
  });
});

describe('bucketRevenue', () => {
  describe('by day', () => {
    it('returns one point per day of the window, oldest first', () => {
      const points = bucketRevenue(
        [],
        window('2026-07-01', '2026-07-04'),
        'day',
      );
      expect(points.map((p) => p.at)).toEqual([
        '2026-07-01',
        '2026-07-02',
        '2026-07-03',
      ]);
    });

    it('carries each day’s takings onto its own point', () => {
      const points = bucketRevenue(
        [day('2026-07-02', 45_000)],
        window('2026-07-01', '2026-07-04'),
        'day',
      );
      expect(points.map((p) => p.netSatang)).toEqual([0, 45_000, 0]);
    });

    it('reports a day with no revenue as zero, not as a gap', () => {
      // A missing day would draw the chart shorter than the period it claims to
      // cover, and the flat stretch is exactly what the reader is looking for.
      const points = bucketRevenue(
        [],
        window('2026-07-01', '2026-07-08'),
        'day',
      );
      expect(points).toHaveLength(7);
      expect(points.every((p) => p.netSatang === 0)).toBe(true);
    });
  });

  describe('by week', () => {
    it('opens each bucket on the Monday of its week', () => {
      // 2026-07-01 is a Wednesday; its week opened on Monday the 29th of June.
      const points = bucketRevenue(
        [day('2026-07-01', 10_000)],
        window('2026-07-01', '2026-07-08'),
        'week',
      );
      expect(points[0].at).toBe('2026-06-29');
    });

    it('adds every day of a week into one point', () => {
      const points = bucketRevenue(
        [
          day('2026-07-01', 10_000),
          day('2026-07-03', 5_000),
          day('2026-07-06', 2_000),
        ],
        window('2026-07-01', '2026-07-08'),
        'week',
      );
      expect(points).toEqual([
        { at: '2026-06-29', netSatang: 15_000 },
        { at: '2026-07-06', netSatang: 2_000 },
      ]);
    });
  });

  describe('by month', () => {
    it('opens each bucket on the first of its month', () => {
      const points = bucketRevenue(
        [day('2026-02-14', 9_000)],
        window('2026-01-01', '2026-04-01'),
        'month',
      );
      expect(points).toEqual([
        { at: '2026-01-01', netSatang: 0 },
        { at: '2026-02-01', netSatang: 9_000 },
        { at: '2026-03-01', netSatang: 0 },
      ]);
    });

    it('spans a year end without losing a month', () => {
      const points = bucketRevenue(
        [],
        window('2025-11-01', '2026-02-01'),
        'month',
      );
      expect(points.map((p) => p.at)).toEqual([
        '2025-11-01',
        '2025-12-01',
        '2026-01-01',
      ]);
    });
  });

  it('gives an empty chart for an empty window rather than one stray point', () => {
    expect(
      bucketRevenue([], window('2026-07-01', '2026-07-01'), 'day'),
    ).toEqual([]);
  });
});
