import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Sarabun, the Thai face the PDF exports are drawn with (US-RPT-11).
 *
 * A PDF embeds the glyphs it draws rather than trusting the reader's machine,
 * so a report of Thai event names needs a Thai-capable font compiled INTO the
 * file — pdfkit's built-in Helvetica has no Thai glyphs at all and would print
 * every Thai name as blanks.
 *
 * Sarabun is by Cadson Demak under the SIL Open Font License 1.1 and covers
 * Thai, Latin and ฿. It is committed to this repo with its licence rather than
 * fetched, so a build with no network still renders a correct document.
 *
 * DEPLOYMENT: these files live under `assets/` at the repo root and are
 * resolved relative to this module, which works from `src/` and from `dist/`
 * alike. An image that copies only `dist/` must copy `assets/` too, or the
 * export routes fail with ENOENT.
 */

/** Repo root, from either `src/common/export` or `dist/common/export`. */
const FONT_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  'assets',
  'fonts',
  'sarabun',
);

export const SARABUN_LICENCE = join(FONT_DIR, 'OFL.txt');

export type SarabunWeight = 'regular' | 'bold';

const FILES: Record<SarabunWeight, string> = {
  regular: 'Sarabun-Regular.ttf',
  bold: 'Sarabun-Bold.ttf',
};

export function sarabun(weight: SarabunWeight): string {
  return join(FONT_DIR, FILES[weight]);
}

// Read once and kept: ~90 KB each, and a five-thousand-row export would
// otherwise hit the disk on every page.
const loaded = new Map<SarabunWeight, Buffer>();

export function sarabunBuffer(weight: SarabunWeight): Buffer {
  const cached = loaded.get(weight);
  if (cached) return cached;
  const buffer = readFileSync(sarabun(weight));
  loaded.set(weight, buffer);
  return buffer;
}
