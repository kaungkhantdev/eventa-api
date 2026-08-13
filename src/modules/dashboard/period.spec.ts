import { comparePeriod, periodFor } from './period';

const NOW = new Date('2026-08-07T09:00:00Z'); // 16:00 Bangkok, a Friday

describe('Dashboard periods (US-DASH-08/09)', () => {
  describe('the window, and the one it is compared against', () => {
    it('gives a week its own length again as the previous period', () => {
      const p = periodFor('week', NOW);
      expect(span(p.from, p.to)).toBe(7);
      expect(span(p.previousFrom, p.previousTo)).toBe(7);
    });

    it('makes the previous period end exactly where the current one starts', () => {
      // Adjacent, never overlapping — a registration must not be counted in both
      // halves of its own comparison.
      for (const range of ['week', 'month', 'year'] as const) {
        const p = periodFor(range, NOW);
        expect(p.previousTo.getTime()).toBe(p.from.getTime());
      }
    });

    it('ends the current window at now, so nothing future is counted', () => {
      const p = periodFor('week', NOW);
      expect(p.to.getTime()).toBe(NOW.getTime());
    });

    it('spans 30 days for a month and 365 for a year', () => {
      expect(span(periodFor('month', NOW).from, NOW)).toBe(30);
      expect(span(periodFor('year', NOW).from, NOW)).toBe(365);
    });

    it('starts the window at a Bangkok day boundary, not mid-afternoon', () => {
      // 16:00 Bangkok minus 7 days must be 00:00 Bangkok = 17:00 UTC the night
      // before, or "this week" would silently exclude part of its first day.
      const { from } = periodFor('week', NOW);
      expect(from.toISOString()).toBe('2026-07-31T17:00:00.000Z');
    });
  });

  describe('reading the change (US-DASH-08)', () => {
    it('reports growth as an upward, positive move', () => {
      const change = comparePeriod(150, 100);
      expect(change.direction).toBe('up');
      expect(change.percent).toBe(50);
      expect(change.improved).toBe(true);
    });

    it('reports a fall as downward, and as a worsening', () => {
      const change = comparePeriod(80, 100);
      expect(change.direction).toBe('down');
      expect(change.percent).toBe(-20);
      expect(change.improved).toBe(false);
    });

    it('treats a metric where down is GOOD as improved when it falls', () => {
      // Not every card is "bigger is better"; the caller says which way is up.
      const change = comparePeriod(80, 100, { higherIsBetter: false });
      expect(change.direction).toBe('down');
      expect(change.improved).toBe(true);
    });

    it('is flat and neutral when nothing moved', () => {
      const change = comparePeriod(100, 100);
      expect(change.direction).toBe('flat');
      expect(change.percent).toBe(0);
      expect(change.improved).toBeNull();
    });

    it('refuses to invent a percentage from a zero baseline', () => {
      // 0 → 5 is not "+500%", it is "new". Showing a number here would be the
      // misleading value US-DASH-08 forbids.
      const change = comparePeriod(5, 0);
      expect(change.percent).toBeNull();
      expect(change.direction).toBe('up');
    });

    it('is flat with no percentage when both periods are empty', () => {
      const change = comparePeriod(0, 0);
      expect(change.direction).toBe('flat');
      expect(change.percent).toBeNull();
      expect(change.improved).toBeNull();
    });

    it('rounds to one decimal rather than trailing float noise', () => {
      expect(comparePeriod(1, 3).percent).toBe(-66.7);
    });
  });
});

/** Whole days between two instants. */
const span = (from: Date, to: Date) =>
  Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
