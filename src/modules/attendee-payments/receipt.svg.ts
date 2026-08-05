import { formatBaht } from '../../common/money/baht';
import type { ReceiptRow } from './attendee-payments.types';

const WIDTH = 600;
const HEIGHT = 760;
const LEFT = 60;
const RIGHT = WIDTH - 60;
const PERCENT = 100;

/**
 * The downloadable VAT receipt (US-DISC-10): one self-contained SVG showing the
 * organizer (with tax id), the buyer, the transaction, and the VAT breakdown in
 * Baht. The VAT amount is the one RECORDED on the order at purchase — the
 * receipt reproduces the ledger, it never recomputes it.
 */
export function renderReceiptSvg(row: ReceiptRow): string {
  const net = row.amountSatang - row.vatSatang;
  const vatPercent = Math.round(row.vatRate * PERCENT);
  const when =
    row.paidAt?.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Bangkok',
    }) ?? '—';
  const refundBanner =
    row.status === 'refunded'
      ? `<text x="${WIDTH / 2}" y="205" text-anchor="middle" font-size="26" font-weight="bold" fill="#b91c1c">REFUNDED</text>`
      : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" font-family="Helvetica, Arial, sans-serif">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff" stroke="#111111" stroke-width="2" rx="16"/>
  <text x="${WIDTH / 2}" y="70" text-anchor="middle" font-size="26" font-weight="bold" fill="#111111">VAT Receipt</text>
  <text x="${WIDTH / 2}" y="105" text-anchor="middle" font-size="18" fill="#111111">${escapeXml(row.organizerName)}</text>
  ${line(135, row.organizerAddress)}
  ${line(160, row.organizerTaxId ? `Tax ID ${row.organizerTaxId}` : null)}
  ${refundBanner}
  ${field(250, 'Invoice no.', row.reference)}
  ${field(285, 'Date', when)}
  ${field(320, 'Billed to', `${row.buyerName} · ${row.buyerEmail}`)}
  ${field(355, 'Event', row.eventName)}
  ${field(390, 'Payment method', row.method)}
  <line x1="${LEFT}" y1="430" x2="${RIGHT}" y2="430" stroke="#cccccc"/>
  ${amount(475, `Amount excluding VAT`, net)}
  ${amount(510, `VAT ${vatPercent}% (included)`, row.vatSatang)}
  <line x1="${LEFT}" y1="540" x2="${RIGHT}" y2="540" stroke="#cccccc"/>
  ${amount(580, 'Total paid', row.amountSatang, true)}
  <text x="${WIDTH / 2}" y="680" text-anchor="middle" font-size="13" fill="#777777">Prices are VAT-inclusive; all amounts settle in Thai Baht.</text>
</svg>`;
}

function line(y: number, value: string | null): string {
  if (!value) return '';
  return `<text x="${WIDTH / 2}" y="${y}" text-anchor="middle" font-size="14" fill="#555555">${escapeXml(value)}</text>`;
}

function field(y: number, label: string, value: string): string {
  return `<text x="${LEFT}" y="${y}" font-size="15" fill="#777777">${escapeXml(label)}</text>
  <text x="${RIGHT}" y="${y}" text-anchor="end" font-size="15" fill="#111111">${escapeXml(value)}</text>`;
}

function amount(
  y: number,
  label: string,
  satang: number,
  bold = false,
): string {
  const weight = bold ? ' font-weight="bold"' : '';
  const size = bold ? 20 : 16;
  return `<text x="${LEFT}" y="${y}" font-size="${size}"${weight} fill="#111111">${escapeXml(label)}</text>
  <text x="${RIGHT}" y="${y}" text-anchor="end" font-size="${size}"${weight} fill="#111111">${formatBaht(satang)}</text>`;
}

/** Every stored string is escaped — an organizer name is not markup. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
