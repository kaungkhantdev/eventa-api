import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FONT_ASSET_OUT_DIR, sarabun, sarabunLicence } from './thai-font';

/**
 * The PDF has to be able to write Thai (US-RPT-11, TC-RPT-22).
 *
 * A PDF embeds the glyphs it draws, so without a Thai-capable font every Thai
 * event name comes out as blanks or tofu — and the report is unreadable for
 * exactly the events it is most often run for.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..');

describe('the embedded Thai font', () => {
  it('resolves to a face that is actually on disk', () => {
    expect(existsSync(sarabun('regular'))).toBe(true);
    expect(existsSync(sarabun('bold'))).toBe(true);
  });

  it('carries its licence beside it, as the OFL requires', () => {
    expect(existsSync(sarabunLicence())).toBe(true);
  });

  it('is copied into the build output, so an image shipping dist alone still renders Thai', () => {
    // The faces live outside `src/`, so nothing copies them unless the build
    // is told to. Asserting the file exists in the source tree would prove
    // only that the repo is checked out — this asserts the deployment step.
    const config = JSON.parse(
      readFileSync(join(REPO_ROOT, 'nest-cli.json'), 'utf8'),
    ) as { compilerOptions?: { assets?: unknown[] } };
    const assets = config.compilerOptions?.assets ?? [];

    expect(assets).toContainEqual(
      expect.objectContaining({
        include: expect.stringContaining('assets/fonts/sarabun') as string,
        outDir: FONT_ASSET_OUT_DIR,
      }),
    );
  });
});
