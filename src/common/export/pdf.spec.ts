import type { TabularDocument } from './tabular';
import { renderPdf } from './pdf';

/**
 * The report as a branded PDF (US-RPT-11, TC-RPT-22).
 *
 * "A tidy, branded, readable document showing the key figures, the table, the
 * applied filters, and the generation time." Most of that is a matter of
 * looking at it, which a test cannot do — so what is asserted here is what
 * would break SILENTLY: that a real PDF comes out, that the Thai font is
 * embedded with its Thai code points mapped, that the timestamp is the one
 * asked for, and that the pages keep coming when the rows do.
 */

const GENERATED = new Date('2026-09-22T07:05:00.000Z');

function doc(over: Partial<TabularDocument> = {}): TabularDocument {
  return {
    title: 'Income',
    sheetName: 'Income by event',
    generatedAt: GENERATED,
    filters: [{ label: 'Period', value: 'Jul 1, 2026 – Jul 31, 2026' }],
    summary: [{ label: 'Gross revenue', kind: 'money', value: 107_000 }],
    table: {
      columns: [
        { header: 'Event', kind: 'text' },
        { header: 'Gross (THB)', kind: 'money' },
      ],
      rows: [['Tech Summit 2026', 107_000]],
    },
    matched: 1,
    ...over,
  };
}

/** Uncompressed, so the assertions can read the structures pdfkit wrote. */
const readable = (over: Partial<TabularDocument> = {}) =>
  renderPdf(doc(over), { compress: false });

describe('the file itself', () => {
  it('is a PDF', async () => {
    const buffer = await renderPdf(doc());
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buffer.toString('latin1')).toContain('%%EOF');
  });

  it('records when the figures were taken, not when the bytes were written', async () => {
    const text = (await readable()).toString('latin1');
    expect(text).toContain('/Title');
    // 2026-09-22T07:05Z, as PDF states a date.
    expect(text).toContain('D:20260922070500Z');
  });
});

describe('Thai', () => {
  it('embeds the Thai font rather than hoping the reader has one', async () => {
    const text = (await readable()).toString('latin1');
    expect(text).toMatch(/\/BaseFont\s*\/[A-Z]{6}\+Sarabun/);
  });

  it('maps Thai code points, so the text can be read and copied out', async () => {
    // Without a ToUnicode entry the glyphs draw but select as gibberish.
    const text = (
      await readable({
        table: {
          columns: [{ header: 'Event', kind: 'text' }],
          rows: [['มหกรรมเทคโนโลยีกรุงเทพ']],
        },
      })
    ).toString('latin1');
    expect(text).toContain('ToUnicode');
    // ม is U+0E21.
    expect(text).toMatch(/0e21/i);
  });
});

/** How many pages pdfkit actually wrote. */
const pagesIn = (buffer: Buffer) =>
  buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g)?.length ?? 0;

describe('what the document says', () => {
  it('does not grow a blank page under each footer', async () => {
    // The footer sits inside the bottom margin, and pdfkit answers text that
    // crosses that line by starting a new page — once per page, each one blank
    // but for the footer it was meant to carry.
    expect(pagesIn(await readable())).toBe(1);
  });

  it('keeps going onto new pages as the rows do', async () => {
    const rows = Array.from({ length: 120 }, (_, index) => [
      `Event ${index}`,
      100_000 + index,
    ]);
    const text = (
      await readable({
        table: {
          columns: [
            { header: 'Event', kind: 'text' },
            { header: 'Gross (THB)', kind: 'money' },
          ],
          rows,
        },
        matched: 120,
      })
    ).toString('latin1');
    expect(text.match(/\/Type\s*\/Page[^s]/g)?.length ?? 0).toBeGreaterThan(1);
  });

  it('renders a report that matched nothing, rather than an empty sheet of paper', async () => {
    const buffer = await renderPdf(
      doc({
        table: { columns: [{ header: 'Event', kind: 'text' }], rows: [] },
        matched: 0,
      }),
    );
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('does not throw on money the reader may not see', async () => {
    // It renders as the masked dash; what matters here is that a null never
    // reaches pdfkit as a value it cannot draw.
    const buffer = await renderPdf(
      doc({
        table: {
          columns: [{ header: 'Revenue (THB)', kind: 'money' }],
          rows: [[null]],
        },
        summary: [{ label: 'Net revenue', kind: 'money', value: null }],
      }),
    );
    expect(buffer.length).toBeGreaterThan(0);
  });
});
