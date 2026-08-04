import { toString as qrToString } from 'qrcode';

/** Medium correction level: survives a fold or a smudge when printed. */
const QR_OPTIONS = {
  type: 'svg',
  errorCorrectionLevel: 'M',
  margin: 2,
  width: 512,
} as const;

/**
 * Render any payload as a printable QR SVG — vectors print sharp at any size.
 * Used by ticket-sharing (a registration link, US-TKT-06) and the attendee's
 * entry pass (a ticket token, US-DISC-07); shared here so both QRs look and
 * scan identically.
 */
export function qrSvg(content: string): Promise<string> {
  return qrToString(content, QR_OPTIONS);
}
