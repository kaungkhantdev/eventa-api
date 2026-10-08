import { DomainException } from '../../common/errors/domain.exception';
import { DAY_MS } from '../../common/time/bangkok';
import { MAX_SPAN_DAYS, resolveReportPeriod } from './reports-period';

/**
 * The window every report covers (US-RPT-02).
 *
 * One resolver for all eight, because US-RPT-12 requires their totals to agree:
 * two reports that each decide for themselves what "last 90 days" means will
 * disagree at the boundary and nobody will be able to say which is right.
 */

/** A fixed instant to reason from: 18:40 Bangkok on 19 Jul 2026. */
const NOW = new Date('2026-07-19T11:40:00.000Z');

/** Bangkok midnight opening the given calendar day, as the resolver returns it. */
const bkkMidnight = (day: string) => new Date(`${day}T00:00:00.000+07:00`);

describe('resolveReportPeriod', () => {
  describe('the window asked for', () => {
    it('covers a year when nothing is asked for', () => {
      const period = resolveReportPeriod({}, NOW);
      expect(period.days).toBe(365);
    });

    it('resolves each named range the overview offers', () => {
      expect(resolveReportPeriod({ range: '7d' }, NOW).days).toBe(7);
      expect(resolveReportPeriod({ range: '30d' }, NOW).days).toBe(30);
      expect(resolveReportPeriod({ range: '90d' }, NOW).days).toBe(90);
      expect(resolveReportPeriod({ range: 'year' }, NOW).days).toBe(365);
    });

    it('lets explicit dates win over a named range', () => {
      const period = resolveReportPeriod(
        { from: '2026-07-01', to: '2026-07-07', range: 'year' },
        NOW,
      );
      expect(period.days).toBe(7);
      expect(period.from).toEqual(bkkMidnight('2026-07-01'));
    });
  });

  describe('day boundaries', () => {
    it('opens at Bangkok midnight, not at the hour the request arrived', () => {
      // Starting mid-afternoon would quietly drop most of the first day while
      // still calling the window seven days — the same reasoning the dashboard's
      // own period resolver records.
      expect(resolveReportPeriod({ range: '7d' }, NOW).from).toEqual(
        bkkMidnight('2026-07-13'),
      );
    });

    it('includes the whole of the end day', () => {
      // An end of midnight ON the end day would drop that entire day's takings —
      // the report would say "to 7 July" and silently stop at the 6th.
      const period = resolveReportPeriod(
        { from: '2026-07-01', to: '2026-07-07' },
        NOW,
      );
      expect(period.to).toEqual(bkkMidnight('2026-07-08'));
    });

    it('treats a single day as one day, not nothing', () => {
      const period = resolveReportPeriod(
        { from: '2026-07-07', to: '2026-07-07' },
        NOW,
      );
      expect(period.days).toBe(1);
    });
  });

  describe('the comparison window', () => {
    it('sits immediately before the period and is the same length', () => {
      const period = resolveReportPeriod(
        { from: '2026-07-08', to: '2026-07-14' },
        NOW,
      );
      expect(period.previousTo).toEqual(period.from);
      expect(period.previousFrom).toEqual(bkkMidnight('2026-07-01'));
    });

    it('never overlaps the period it is compared against', () => {
      // Anything counted in both halves would be compared with itself.
      const { from, previousTo } = resolveReportPeriod({ range: '30d' }, NOW);
      expect(previousTo.getTime()).toBeLessThanOrEqual(from.getTime());
    });
  });

  describe('refusals and limits', () => {
    it('refuses an end date before the start date', () => {
      expect(() =>
        resolveReportPeriod({ from: '2026-07-07', to: '2026-07-01' }, NOW),
      ).toThrow(DomainException);
    });

    it('says which way round the dates go', () => {
      expect(() =>
        resolveReportPeriod({ from: '2026-07-07', to: '2026-07-01' }, NOW),
      ).toThrow('End date must be on or after the start date');
    });

    it('refuses a date it cannot read rather than reporting on a guess', () => {
      expect(() =>
        resolveReportPeriod({ from: 'last tuesday', to: '2026-07-01' }, NOW),
      ).toThrow(DomainException);
    });

    it('trims a span longer than the cap, keeping the recent end', () => {
      // Four years asked for. The end the organizer cares about is the recent
      // one, so that is the end that survives.
      const period = resolveReportPeriod(
        { from: '2022-07-19', to: '2026-07-19' },
        NOW,
      );
      expect(period.days).toBe(MAX_SPAN_DAYS);
      expect(period.to).toEqual(bkkMidnight('2026-07-20'));
      expect(period.from).toEqual(
        new Date(period.to.getTime() - MAX_SPAN_DAYS * DAY_MS),
      );
    });

    it('reports that it trimmed, so the caller can say so', () => {
      expect(
        resolveReportPeriod({ from: '2022-07-19', to: '2026-07-19' }, NOW)
          .trimmed,
      ).toBe(true);
      expect(
        resolveReportPeriod({ from: '2026-07-01', to: '2026-07-07' }, NOW)
          .trimmed,
      ).toBe(false);
    });

    it('allows a span exactly at the cap', () => {
      // 19 Jul 2024 through 19 Jul 2026 inclusive is 731 days — two years and
      // the leap day, which is what "24 months" is capped at.
      const period = resolveReportPeriod(
        { from: '2024-07-19', to: '2026-07-19' },
        NOW,
      );
      expect(period.days).toBe(MAX_SPAN_DAYS);
      expect(period.trimmed).toBe(false);
    });
  });
});
