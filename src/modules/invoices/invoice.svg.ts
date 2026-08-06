import { formatBaht } from '../../common/money/baht';
import { escapeXml } from '../../common/xml/escape-xml';
import type { InvoiceDocumentRow } from './invoices.types';

/** A4 portrait at 72dpi, so it prints as exactly one page. */
const WIDTH = 595;
const HEIGHT = 842;
const LEFT = 56;
const RIGHT = WIDTH - 56;
const PERCENT = 100;

/**
 * The printable tax invoice (US-FIN-08): one self-contained A4 SVG carrying the
 * seller's legal identity and tax id, the buyer, the event service line, and a
 * VAT breakdown that reconciles to the amount charged.
 *
 * The figures are the ones STORED on the invoice — they are never recomputed
 * here. A tax invoice is a snapshot of a transaction, so a later change to the
 * workspace's VAT rate must not restate a document already handed to a buyer.
 */
export function renderInvoiceSvg(row: InvoiceDocumentRow): string {
  const vatPercent = Math.round(row.vatRate * PERCENT);
  const voidBanner =
    row.status === 'void'
      ? `<text x="${WIDTH / 2}" y="300" text-anchor="middle" font-size="52" font-weight="bold" fill="#b91c1c" opacity="0.25" transform="rotate(-18 ${WIDTH / 2} 300)">VOID</text>`
      : '';
  const paid = row.paidVia
    ? `${row.paidVia}${row.paidOn ? ` · ${row.paidOn}` : ''}`
    : 'Unpaid';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" font-family="Helvetica, Arial, sans-serif">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff"/>
  <text x="${LEFT}" y="72" font-size="24" font-weight="bold" fill="#111111">TAX INVOICE</text>
  <text x="${RIGHT}" y="72" text-anchor="end" font-size="18" font-weight="bold" fill="#111111">${escapeXml(row.number)}</text>

  <text x="${LEFT}" y="118" font-size="15" font-weight="bold" fill="#111111">${escapeXml(row.sellerName)}</text>
  ${sellerLine(140, row.sellerAddress)}
  ${sellerLine(160, row.sellerTaxId ? `Tax ID ${row.sellerTaxId}` : null)}
  <line x1="${LEFT}" y1="190" x2="${RIGHT}" y2="190" stroke="#dddddd"/>

  ${field(222, 'Billed to', row.buyerName)}
  ${field(246, 'Email', row.buyerEmail)}
  ${field(270, 'Order', row.orderReference)}
  ${field(294, 'Issued', row.issuedAt)}
  ${field(318, 'Due', row.dueAt)}
  ${field(342, 'Payment', paid)}
  ${voidBanner}

  <line x1="${LEFT}" y1="392" x2="${RIGHT}" y2="392" stroke="#111111"/>
  <text x="${LEFT}" y="416" font-size="13" fill="#777777">DESCRIPTION</text>
  <text x="${RIGHT}" y="416" text-anchor="end" font-size="13" fill="#777777">AMOUNT</text>
  <line x1="${LEFT}" y1="428" x2="${RIGHT}" y2="428" stroke="#dddddd"/>
  <text x="${LEFT}" y="456" font-size="15" fill="#111111">Event registration — ${escapeXml(row.eventName)}</text>
  <text x="${RIGHT}" y="456" text-anchor="end" font-size="15" fill="#111111">${formatBaht(row.subtotalSatang)}</text>

  <line x1="${LEFT}" y1="492" x2="${RIGHT}" y2="492" stroke="#dddddd"/>
  ${amount(520, 'Subtotal (excl. VAT)', row.subtotalSatang)}
  ${amount(546, `VAT ${vatPercent}%`, row.vatAmountSatang)}
  <line x1="${LEFT}" y1="568" x2="${RIGHT}" y2="568" stroke="#111111"/>
  ${amount(600, 'Total', row.amountSatang, true)}

  <text x="${LEFT}" y="700" font-size="12" fill="#777777">Amounts are in Thai Baht. Payment terms: 14 days from the issue date.</text>
  <text x="${LEFT}" y="720" font-size="12" fill="#777777">This document is a tax invoice issued under Thai VAT regulations.</text>
</svg>`;
}

function sellerLine(y: number, value: string | null): string {
  if (!value) return '';
  return `<text x="${LEFT}" y="${y}" font-size="13" fill="#555555">${escapeXml(value)}</text>`;
}

function field(y: number, label: string, value: string): string {
  return `<text x="${LEFT}" y="${y}" font-size="13" fill="#777777">${escapeXml(label)}</text>
  <text x="${RIGHT}" y="${y}" text-anchor="end" font-size="14" fill="#111111">${escapeXml(value)}</text>`;
}

function amount(
  y: number,
  label: string,
  satang: number,
  bold = false,
): string {
  const weight = bold ? ' font-weight="bold"' : '';
  const size = bold ? 18 : 14;
  return `<text x="${LEFT}" y="${y}" font-size="${size}"${weight} fill="#111111">${escapeXml(label)}</text>
  <text x="${RIGHT}" y="${y}" text-anchor="end" font-size="${size}"${weight} fill="#111111">${formatBaht(satang)}</text>`;
}
