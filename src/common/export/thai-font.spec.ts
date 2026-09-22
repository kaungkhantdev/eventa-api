import { existsSync } from 'node:fs';
import { SARABUN_LICENCE, sarabun } from './thai-font';

/**
 * The PDF has to be able to write Thai (US-RPT-11, TC-RPT-22).
 *
 * A PDF embeds the glyphs it draws, so without a Thai-capable font every Thai
 * event name comes out as blanks or tofu — and the report is unreadable for
 * exactly the events it is most often run for.
 */

describe('the embedded Thai font', () => {
  it('ships with the repo, so a deployment cannot silently lose it', () => {
    expect(existsSync(sarabun('regular'))).toBe(true);
    expect(existsSync(sarabun('bold'))).toBe(true);
  });

  it('carries its licence beside it, as the OFL requires', () => {
    expect(existsSync(SARABUN_LICENCE)).toBe(true);
  });
});
