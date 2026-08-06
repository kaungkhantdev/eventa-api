import { escapeXml } from '../../common/xml/escape-xml';
import type { TicketPassDto } from './dto/my-events.dto';

const WIDTH = 600;
const HEIGHT = 940;
const QR_SIZE = 440;
const QR_X = (WIDTH - QR_SIZE) / 2;
const QR_Y = 320;

/**
 * The printable entry pass (US-DISC-07): one self-contained SVG carrying the
 * QR, event name, date, venue, ticket class, seat and admission number — a
 * vector, so it prints sharp at any size. No external fonts or images: what the
 * attendee downloads is exactly what the door scans.
 */
export function renderPassSvg(pass: TicketPassDto, qrSvg: string): string {
  const when = formatWhen(pass.startAt, pass.timezone);
  const where = pass.isOnline
    ? 'Online event'
    : [pass.venueName, pass.city].filter(Boolean).join(' · ');
  const seat = pass.seat
    ? `Seat ${[pass.seat.section, pass.seat.row, pass.seat.number]
        .filter(Boolean)
        .join('-')}`
    : 'General admission';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" font-family="Helvetica, Arial, sans-serif">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff" stroke="#111111" stroke-width="2" rx="24"/>
  <text x="${WIDTH / 2}" y="80" text-anchor="middle" font-size="30" font-weight="bold" fill="#111111">${escapeXml(pass.eventName)}</text>
  <text x="${WIDTH / 2}" y="130" text-anchor="middle" font-size="20" fill="#333333">${escapeXml(when)}</text>
  <text x="${WIDTH / 2}" y="165" text-anchor="middle" font-size="20" fill="#333333">${escapeXml(where)}</text>
  <text x="${WIDTH / 2}" y="225" text-anchor="middle" font-size="24" font-weight="bold" fill="#111111">${escapeXml(pass.ticketLabel ?? 'Ticket')}</text>
  <text x="${WIDTH / 2}" y="260" text-anchor="middle" font-size="18" fill="#333333">${escapeXml(seat)}</text>
  ${embedQr(qrSvg)}
  <text x="${WIDTH / 2}" y="${QR_Y + QR_SIZE + 50}" text-anchor="middle" font-size="20" font-weight="bold" fill="#111111">${escapeXml(pass.reference)}</text>
  <text x="${WIDTH / 2}" y="${QR_Y + QR_SIZE + 85}" text-anchor="middle" font-size="16" fill="#555555">Admission ${escapeXml(pass.admissionNumber)}${pass.holderName ? ` · ${escapeXml(pass.holderName)}` : ''}</text>
</svg>`;
}

/**
 * Nest the QR's own SVG inside the pass at a fixed position. The generator's
 * output always opens with `<svg xmlns=…`, and a nested <svg> with x/y/width/
 * height is standard SVG — no re-parsing of the QR content required.
 */
function embedQr(qrSvg: string): string {
  return qrSvg.replace(
    '<svg ',
    `<svg x="${QR_X}" y="${QR_Y}" width="${QR_SIZE}" height="${QR_SIZE}" `,
  );
}

/** UTC instant → the event's own wall clock, readable on a printed ticket. */
function formatWhen(startAt: string, timezone: string): string {
  return new Date(startAt).toLocaleString('en-GB', {
    timeZone: timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
