import type { PublicPage } from './public-pages.types';

/** Fold long iCalendar lines at 75 octets, per RFC 5545. */
function fold(line: string): string {
  const chunks: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    chunks.push(rest.slice(0, 75));
    rest = ` ${rest.slice(75)}`;
  }
  chunks.push(rest);
  return chunks.join('\r\n');
}

/** Escape the characters iCalendar treats as structure. */
function escape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function stamp(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

/**
 * Build the calendar entry for an event (US-PAGE-07).
 *
 * The UID is derived from the event id, so adding the same event again UPDATES
 * the existing entry instead of creating a duplicate. Times are absolute UTC
 * instants, which every calendar renders in the viewer's zone — Bangkok for a
 * Thai attendee. An online event's private join link is never included; only the
 * public page URL is.
 */
export function toCalendar(page: PublicPage, host: string): string {
  const { event } = page;
  const end =
    event.endAt ??
    new Date(new Date(event.startAt).getTime() + 60 * 60 * 1000).toISOString();
  const location = event.isOnline
    ? 'Online event'
    : [event.venueName, event.venueAddress, event.city]
        .filter(Boolean)
        .join(', ');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//Eventa//${host}//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.id}@${host}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(new Date(event.startAt))}`,
    `DTEND:${stamp(new Date(end))}`,
    `SUMMARY:${escape(event.name)}`,
    `DESCRIPTION:${escape(event.description ?? '')}`,
    `LOCATION:${escape(location)}`,
    `URL:${page.share.url}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n');
}

/** Without a clear start there is nothing sane to add (US-PAGE-07). */
export function canAddToCalendar(page: PublicPage): boolean {
  return Boolean(page.event.startAt);
}
