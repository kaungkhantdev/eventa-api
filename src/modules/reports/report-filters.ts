import { displayCell } from '../../common/export/display';
import type { FilterLine } from '../../common/export/tabular';
import { MAX_SPAN_DAYS, type ReportPeriod } from './reports-period';

/**
 * The filters the reader had applied, as the file says them back (US-RPT-11).
 *
 * The PDF and the workbook's summary both carry these, because a report that
 * travels to finance without saying what it covers is a page of numbers nobody
 * can check. The story asks for the applied filters by name.
 *
 * Read off the RESOLVED period rather than the query: a span over the cap was
 * trimmed, and a file quoting the window that was asked for rather than the one
 * that was used would be reconciled against the wrong dates.
 */

/** One millisecond inside the last day, since `period.to` is exclusive. */
const LAST_INSTANT = 1;

export interface ReportFilterDescription {
  eventId?: string;
  q?: string;
  /** Only the event performance report has a stage. */
  status?: string;
}

export function describeReportFilters(
  query: ReportFilterDescription,
  period: ReportPeriod,
  eventName: string | null,
): FilterLine[] {
  const lines: FilterLine[] = [
    { label: 'Period', value: periodLine(period) },
    { label: 'Event', value: eventLine(query.eventId, eventName) },
  ];
  if (query.q) lines.push({ label: 'Search', value: query.q });
  if (query.status) {
    lines.push({ label: 'Stage', value: displayCell('status', query.status) });
  }
  return lines;
}

function periodLine(period: ReportPeriod): string {
  const from = displayCell('day', period.from);
  const to = displayCell('day', new Date(period.to.getTime() - LAST_INSTANT));
  const span = `${from} – ${to}`;
  return period.trimmed ? `${span} (trimmed to ${MAX_SPAN_DAYS} days)` : span;
}

/**
 * The event, by name where it is this workspace's to name.
 *
 * An id that matched nothing stays "Selected event": printing the raw UUID is
 * unreadable, and printing a name looked up without the tenant scope would put
 * another workspace's event in this one's file.
 */
function eventLine(eventId: string | undefined, name: string | null): string {
  if (!eventId) return 'All events';
  return name ?? 'Selected event';
}
