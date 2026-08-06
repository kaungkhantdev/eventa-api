/**
 * Byte-order mark. Excel assumes the local codepage for a plain UTF-8 file, so
 * without this a Thai buyer name opens as mojibake — the BOM is what makes
 * `อนันต์` render as itself in a spreadsheet.
 */
export const UTF8_BOM = '﻿';

export const CSV_MIME = 'text/csv; charset=utf-8';

export type CsvValue = string | number | null | undefined;

/** Characters a spreadsheet treats as the start of a formula. */
const FORMULA_LEADS = ['=', '+', '-', '@', '\t', '\r'];
const NEEDS_QUOTING = /[",\n\r]/;

/**
 * Render rows as RFC-4180 CSV, BOM-first.
 *
 * Stored text is neutralised before it is written: a buyer who names themselves
 * `=IMPORTXML(...)` would otherwise have that run as a formula the moment an
 * accountant opens the file. Prefixing an apostrophe keeps the value readable
 * while making it inert. Numbers are exempt, so a negative figure stays a
 * figure rather than becoming text.
 */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly CsvValue[])[],
): string {
  const lines = [
    header.map(cell).join(','),
    ...rows.map((row) => row.map(cell).join(',')),
  ];
  return `${UTF8_BOM}${lines.join('\n')}\n`;
}

function cell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  const neutralised = FORMULA_LEADS.some((lead) => value.startsWith(lead));
  const safe = neutralised ? `'${value}` : value;
  return neutralised || NEEDS_QUOTING.test(safe)
    ? `"${safe.replace(/"/g, '""')}"`
    : safe;
}
