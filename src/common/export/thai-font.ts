import { existsSync, readFileSync } from 'node:fs';
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
 */

/**
 * Where the build puts the faces, so `dist/` carries them (`nest-cli.json`).
 *
 * The faces live outside `src/`, which means nothing copies them unless the
 * build is told to — and an image that ships only `dist/` would then answer
 * every export request with ENOENT. Named here because this module and the
 * build config have to agree; `thai-font.spec` holds them to it.
 */
export const FONT_ASSET_OUT_DIR = 'dist/assets';

/**
 * Where to look, nearest first.
 *
 * `../../assets` is the copy beside the compiled code (`dist/assets`), which
 * is the one a deployment has. `../../../assets` is the repo root, which is
 * what running from `src/` — and `node dist/main` from a full checkout — sees.
 */
const FONT_DIRS = [
  join(__dirname, '..', '..', 'assets', 'fonts', 'sarabun'),
  join(__dirname, '..', '..', '..', 'assets', 'fonts', 'sarabun'),
];

export type SarabunWeight = 'regular' | 'bold';

const FILES: Record<SarabunWeight, string> = {
  regular: 'Sarabun-Regular.ttf',
  bold: 'Sarabun-Bold.ttf',
};

const LICENCE_FILE = 'OFL.txt';

/**
 * The first candidate that actually holds the file.
 *
 * Absent from both, the error says where it looked and what to do: a bare
 * ENOENT on a font path is a puzzle for whoever is paged at the time.
 */
function resolve(file: string): string {
  const found = FONT_DIRS.map((dir) => join(dir, file)).find((path) =>
    existsSync(path),
  );
  if (found) return found;
  throw new Error(
    `Missing the Sarabun face ${file}, without which a PDF export cannot ` +
      `render Thai. Looked in: ${FONT_DIRS.join(', ')}. A deployment must ` +
      `ship assets/fonts/sarabun (the build copies it to ${FONT_ASSET_OUT_DIR}).`,
  );
}

/**
 * Resolved on demand rather than at import: a missing face must fail the
 * export that needs it, loudly and with the message above — not take the whole
 * API down at boot over a report format.
 */
export function sarabunLicence(): string {
  return resolve(LICENCE_FILE);
}

export function sarabun(weight: SarabunWeight): string {
  return resolve(FILES[weight]);
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
