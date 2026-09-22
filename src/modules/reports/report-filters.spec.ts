import { resolveReportPeriod } from './reports-period';
import { describeReportFilters } from './report-filters';

/**
 * What the file says the reader was looking at (US-RPT-11).
 *
 * "The applied filters" on the PDF and the workbook's summary. It matters that
 * this reads back the window ACTUALLY used rather than the one asked for: a
 * span over the cap is trimmed, and a file that hid that would be reconciled
 * against the wrong two years.
 */

const NOW = new Date('2026-09-22T07:05:00.000Z');

const july = () =>
  resolveReportPeriod({ from: '2026-07-01', to: '2026-07-31' }, NOW);

const lineFor = (
  lines: { label: string; value: string }[],
  label: string,
): string | undefined => lines.find((line) => line.label === label)?.value;

describe('the period', () => {
  it('states the last day the reader included, not the exclusive bound', () => {
    // The window closes at midnight opening Aug 1; the reader asked for July.
    const lines = describeReportFilters({}, july(), null);
    expect(lineFor(lines, 'Period')).toBe('Jul 1, 2026 – Jul 31, 2026');
  });

  it('owns up when the span was longer than the cap allows', () => {
    const period = resolveReportPeriod(
      { from: '2020-01-01', to: '2026-07-31' },
      NOW,
    );
    expect(
      lineFor(describeReportFilters({}, period, null), 'Period'),
    ).toContain('trimmed to 731 days');
  });
});

describe('the event', () => {
  it('says every event when none was picked', () => {
    expect(lineFor(describeReportFilters({}, july(), null), 'Event')).toBe(
      'All events',
    );
  });

  it('names the event when one was picked', () => {
    const lines = describeReportFilters(
      { eventId: 'e-1' },
      july(),
      'Bangkok Tech Summit',
    );
    expect(lineFor(lines, 'Event')).toBe('Bangkok Tech Summit');
  });

  it('stays vague when the id matched nothing this workspace owns', () => {
    // Never another workspace's event name, and never a bare UUID: one leaks,
    // the other is unreadable.
    const lines = describeReportFilters({ eventId: 'e-9' }, july(), null);
    expect(lineFor(lines, 'Event')).toBe('Selected event');
  });
});

describe('the rest of the controls', () => {
  it('shows the search only when one was typed', () => {
    expect(
      lineFor(describeReportFilters({}, july(), null), 'Search'),
    ).toBeUndefined();
    const lines = describeReportFilters({ q: 'gala' }, july(), null);
    expect(lineFor(lines, 'Search')).toBe('gala');
  });

  it('shows the stage only for the report that has one', () => {
    expect(
      lineFor(describeReportFilters({}, july(), null), 'Stage'),
    ).toBeUndefined();
    const lines = describeReportFilters({ status: 'completed' }, july(), null);
    expect(lineFor(lines, 'Stage')).toBe('Completed');
  });
});
