import PDFDocument from 'pdfkit';
import { displayCell, generatedLine } from './display';
import { sarabunBuffer } from './thai-font';
import type { Column, TabularDocument } from './tabular';

/**
 * The report as a branded PDF (US-RPT-11, TC-RPT-22).
 *
 * The story asks for "a tidy, branded, readable document showing the key
 * figures, the table, the applied filters, and the generation time" — the file
 * a stakeholder is sent rather than the one finance recalculates, which is why
 * every figure is rendered the way the product writes it (`displayCell`) and
 * money the reader may not see prints as a dash rather than ฿0.
 *
 * Drawn in Sarabun throughout so Thai event names render: see `thai-font`.
 */

/** The kit's own tokens, so the file looks like the screen it came from. */
const BRAND = '#1ba770';
const BRAND_SOFT = '#e6f6ef';
const INK = '#132a22';
const MUTED = '#8b93a4';
const RULE = '#e5e7eb';

const REGULAR = 'Sarabun';
const BOLD = 'Sarabun-Bold';

const MARGIN = 40;
const ROW_HEIGHT = 18;
const HEADER_HEIGHT = 22;
const CELL_PADDING = 4;
const BODY_SIZE = 8.5;
const TILE_HEIGHT = 44;
const TILE_GAP = 8;
const FOOTER_SPACE = 28;

/** How much of the width each kind of column deserves, relative to the rest. */
const WEIGHT: Record<Column['kind'], number> = {
  text: 26,
  day: 11,
  instant: 15,
  count: 10,
  money: 13,
  percent: 10,
  ratio: 8,
  status: 11,
};

/** The kinds a reader scans down a column, so they line up on the right. */
const RIGHT_ALIGNED = new Set<Column['kind']>([
  'count',
  'money',
  'percent',
  'ratio',
]);

type Doc = PDFKit.PDFDocument;

export interface PdfOptions {
  /** Off only in tests, which read the structures pdfkit wrote. */
  compress?: boolean;
}

export async function renderPdf(
  doc: TabularDocument,
  { compress = true }: PdfOptions = {},
): Promise<Buffer> {
  const pdf = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: MARGIN,
    compress,
    // Held open so the footer can say "Page 2 of 7" — a count nothing knows
    // until the last row has been laid out.
    bufferPages: true,
    info: {
      Title: doc.title,
      Author: 'Eventa',
      // The moment the figures were taken, which the story requires the file
      // to record — not the moment the bytes were written.
      CreationDate: doc.generatedAt,
    },
  });
  pdf.registerFont(REGULAR, sarabunBuffer('regular'));
  pdf.registerFont(BOLD, sarabunBuffer('bold'));

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
  });

  layout(pdf, doc);
  paginate(pdf);
  pdf.end();
  return done;
}

function layout(pdf: Doc, doc: TabularDocument): void {
  let y = masthead(pdf, doc);
  y = filtersLine(pdf, doc, y);
  y = tiles(pdf, doc, y);
  y = rows(pdf, doc, y);
  truncationNote(pdf, doc, y);
}

const contentWidth = (pdf: Doc) => pdf.page.width - MARGIN * 2;
const bottom = (pdf: Doc) => pdf.page.height - MARGIN - FOOTER_SPACE;

/** The wordmark, the timestamp, and the report's name. */
function masthead(pdf: Doc, doc: TabularDocument): number {
  pdf
    .font(BOLD)
    .fontSize(15)
    .fillColor(BRAND)
    .text('Eventa', MARGIN, MARGIN, { lineBreak: false });
  pdf
    .font(REGULAR)
    .fontSize(8.5)
    .fillColor(MUTED)
    .text(generatedLine(doc.generatedAt), MARGIN, MARGIN + 4, {
      width: contentWidth(pdf),
      align: 'right',
      lineBreak: false,
    });
  const y = MARGIN + 26;
  pdf.font(BOLD).fontSize(17).fillColor(INK).text(doc.title, MARGIN, y, {
    lineBreak: false,
  });
  return y + 26;
}

/** What the reader had filtered to, on one line. */
function filtersLine(pdf: Doc, doc: TabularDocument, y: number): number {
  if (doc.filters.length === 0) return y;
  const line = doc.filters
    .map((filter) => `${filter.label}: ${filter.value}`)
    .join('  ·  ');
  pdf
    .font(REGULAR)
    .fontSize(9)
    .fillColor(MUTED)
    .text(line, MARGIN, y, {
      width: contentWidth(pdf),
      lineBreak: false,
      ellipsis: true,
    });
  return y + 20;
}

/** The key figures, as the tiles the screen shows above the table. */
function tiles(pdf: Doc, doc: TabularDocument, y: number): number {
  if (doc.summary.length === 0) return y;
  const width =
    (contentWidth(pdf) - TILE_GAP * (doc.summary.length - 1)) /
    doc.summary.length;
  doc.summary.forEach((figure, index) => {
    const x = MARGIN + index * (width + TILE_GAP);
    pdf.rect(x, y, width, TILE_HEIGHT).fill(BRAND_SOFT);
    pdf
      .font(REGULAR)
      .fontSize(8)
      .fillColor(MUTED)
      .text(figure.label, x + 10, y + 8, {
        width: width - 20,
        lineBreak: false,
        ellipsis: true,
      });
    pdf
      .font(BOLD)
      .fontSize(13)
      .fillColor(INK)
      .text(displayCell(figure.kind, figure.value), x + 10, y + 21, {
        width: width - 20,
        lineBreak: false,
        ellipsis: true,
      });
  });
  return y + TILE_HEIGHT + 16;
}

/** Each column's width in points, scaled so the set fills the page. */
function widths(pdf: Doc, columns: Column[]): number[] {
  const weights = columns.map((column) => WEIGHT[column.kind]);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => (weight / total) * contentWidth(pdf));
}

function tableHeader(pdf: Doc, columns: Column[], sizes: number[], y: number) {
  pdf.rect(MARGIN, y, contentWidth(pdf), HEADER_HEIGHT).fill(BRAND_SOFT);
  pdf.font(BOLD).fontSize(BODY_SIZE).fillColor(INK);
  let x = MARGIN;
  columns.forEach((column, index) => {
    pdf.text(column.header, x + CELL_PADDING, y + 7, {
      width: sizes[index] - CELL_PADDING * 2,
      align: RIGHT_ALIGNED.has(column.kind) ? 'right' : 'left',
      lineBreak: false,
      ellipsis: true,
    });
    x += sizes[index];
  });
  return y + HEADER_HEIGHT;
}

function rows(pdf: Doc, doc: TabularDocument, top: number): number {
  const { columns, rows: cells } = doc.table;
  const sizes = widths(pdf, columns);
  let y = tableHeader(pdf, columns, sizes, top);
  if (cells.length === 0) {
    pdf
      .font(REGULAR)
      .fontSize(9)
      .fillColor(MUTED)
      .text('No rows match these filters.', MARGIN, y + 12, {
        lineBreak: false,
      });
    return y + 32;
  }
  for (const row of cells) {
    if (y + ROW_HEIGHT > bottom(pdf)) {
      pdf.addPage();
      y = tableHeader(pdf, columns, sizes, MARGIN);
    }
    drawRow(pdf, columns, sizes, row, y);
    y += ROW_HEIGHT;
  }
  return y;
}

function drawRow(
  pdf: Doc,
  columns: Column[],
  sizes: number[],
  row: TabularDocument['table']['rows'][number],
  y: number,
): void {
  pdf.font(REGULAR).fontSize(BODY_SIZE).fillColor(INK);
  let x = MARGIN;
  columns.forEach((column, index) => {
    // One line per cell, ellipsised: pdfkit breaks lines by UAX-14, which has
    // no Thai word boundaries, so a wrapped Thai name would break mid-word.
    pdf.text(
      displayCell(column.kind, row[index] ?? null),
      x + CELL_PADDING,
      y + 5,
      {
        width: sizes[index] - CELL_PADDING * 2,
        align: RIGHT_ALIGNED.has(column.kind) ? 'right' : 'left',
        lineBreak: false,
        ellipsis: true,
      },
    );
    x += sizes[index];
  });
  pdf
    .moveTo(MARGIN, y + ROW_HEIGHT)
    .lineTo(pdf.page.width - MARGIN, y + ROW_HEIGHT)
    .lineWidth(0.5)
    .strokeColor(RULE)
    .stroke();
}

/**
 * Say so when the file holds only the first of the matching rows — a reader
 * reconciling against the tiles would otherwise find they do not add up.
 */
function truncationNote(pdf: Doc, doc: TabularDocument, y: number): void {
  const shown = doc.table.rows.length;
  if (doc.matched <= shown) return;
  const note = `Showing the first ${displayCell('count', shown)} of ${displayCell('count', doc.matched)} matching rows.`;
  let at = y + 12;
  if (at > bottom(pdf)) {
    pdf.addPage();
    at = MARGIN;
  }
  pdf.font(REGULAR).fontSize(8.5).fillColor(MUTED).text(note, MARGIN, at, {
    lineBreak: false,
  });
}

/**
 * The footer, written once every page exists and the count is known.
 *
 * The bottom margin is lifted for the write and put back afterwards: the
 * footer sits INSIDE that margin by design, and pdfkit answers text crossing
 * the margin line by starting a new page — which would leave the document with
 * a blank page under every footer, and a page count that grew as it was
 * printed. Sarabun's line box is tall enough to cross it where the default
 * face would not, so the guard is the fix rather than a smaller font.
 */
function paginate(pdf: Doc): void {
  const { start, count } = pdf.bufferedPageRange();
  for (let index = 0; index < count; index += 1) {
    pdf.switchToPage(start + index);
    const bottomMargin = pdf.page.margins.bottom;
    pdf.page.margins.bottom = 0;
    pdf
      .font(REGULAR)
      .fontSize(8)
      .fillColor(MUTED)
      .text(
        `Eventa  ·  Page ${index + 1} of ${count}`,
        MARGIN,
        pdf.page.height - MARGIN - 10,
        { width: contentWidth(pdf), align: 'center', lineBreak: false },
      );
    pdf.page.margins.bottom = bottomMargin;
  }
}
