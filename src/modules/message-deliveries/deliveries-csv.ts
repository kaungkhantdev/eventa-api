import { BANGKOK_OFFSET_MS } from '../../common/time/bangkok';
import type { DeliveryRow } from './message-deliveries.repository';

/**
 * The delivery log, as a file (US-MSG-07).
 *
 * Built from the same rows the JSON endpoint returns, under the same filters,
 * so "the file holds what I was looking at" holds by construction.
 *
 * Two departures from the screen, both because a spreadsheet is read
 * differently from a table:
 *
 *   · The full instant, not "Jul 9 · 10:24". Diagnosing a failed send means
 *     lining it up against a mail server's log, and that needs a year and a
 *     timezone.
 *   · The failure reason is a column of its own rather than a line under a
 *     badge, because sorting and filtering on it is the reason to export.
 */
export interface CsvTable {
  headers: string[];
  rows: string[][];
}

export function deliveriesCsv(rows: DeliveryRow[]): CsvTable {
  return {
    headers: [
      'Sent (UTC)',
      'Sent (Bangkok)',
      'Recipient',
      'Email',
      'Message',
      'Event',
      'Channel',
      'Status',
      'Failure reason',
    ],
    rows: rows.map((row) => [
      row.sentAt.toISOString(),
      bangkok(row.sentAt),
      row.recipientName ?? '',
      row.recipientEmail,
      row.kind,
      row.eventName ?? '',
      row.channel,
      row.status,
      // Empty, not "—": a successful send has no reason, and a dash is a word
      // a spreadsheet cannot filter out.
      row.error ?? '',
    ]),
  };
}

/** `2026-07-09 10:24` — the wall clock the organizer works in. */
function bangkok(at: Date): string {
  return new Date(at.getTime() + BANGKOK_OFFSET_MS)
    .toISOString()
    .slice(0, 16)
    .replace('T', ' ');
}
