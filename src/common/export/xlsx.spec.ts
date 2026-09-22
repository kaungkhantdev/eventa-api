import { Workbook, type CellValue, type Worksheet } from 'exceljs';
import type { TabularDocument } from './tabular';
import { renderXlsx } from './xlsx';

/**
 * The report as a workbook (US-RPT-11).
 *
 * "A summary of the key figures plus the detailed rows, with money and
 * percentages properly formatted" — which in a spreadsheet means the cell holds
 * a NUMBER and the format holds the ฿ or the %. A cell of text reading "฿1,070"
 * is a figure an accountant cannot sum, and the story asks for one they can.
 */

const GENERATED = new Date('2026-09-22T07:05:00.000Z');

function doc(over: Partial<TabularDocument> = {}): TabularDocument {
  return {
    title: 'Income',
    sheetName: 'Income by event',
    generatedAt: GENERATED,
    filters: [
      { label: 'Period', value: 'Jul 1, 2026 – Jul 31, 2026' },
      { label: 'Event', value: 'All events' },
    ],
    summary: [
      { label: 'Gross revenue', kind: 'money', value: 107_000 },
      { label: 'Net revenue', kind: 'money', value: 90_000 },
    ],
    table: {
      columns: [
        { header: 'Event', kind: 'text' },
        { header: 'Starts', kind: 'day' },
        { header: 'Gross (THB)', kind: 'money' },
      ],
      rows: [
        ['Tech Summit 2026', new Date('2026-07-17T20:00:00.000Z'), 107_000],
      ],
    },
    matched: 1,
    ...over,
  };
}

async function open(document: TabularDocument): Promise<Workbook> {
  const buffer = await renderXlsx(document);
  const workbook = new Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook;
}

/** A cell's value as text — exceljs cells can hold rich text and errors too. */
function textOf(value: CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Every cell of a sheet as a flat list of strings, for "does it say X" checks. */
function saidOn(sheet: Worksheet): string[] {
  const said: string[] = [];
  sheet.eachRow((row) => {
    row.eachCell((cell) => said.push(textOf(cell.value)));
  });
  return said;
}

describe('the shape of the workbook', () => {
  it('leads with the key figures and follows with the rows', async () => {
    const workbook = await open(doc());
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Summary',
      'Income by event',
    ]);
  });

  it('freezes the header row and sets it in bold, so a long report stays readable', async () => {
    const workbook = await open(doc());
    const sheet = workbook.getWorksheet('Income by event');
    expect(sheet?.getRow(1).font?.bold).toBe(true);
    const view = sheet?.views?.[0];
    expect(view?.state).toBe('frozen');
    expect(view?.state === 'frozen' ? view.ySplit : undefined).toBe(1);
  });

  it('cuts a sheet name to the 31 characters Excel allows', async () => {
    const workbook = await open(
      doc({ sheetName: 'A report with a very long name indeed' }),
    );
    // Excel refuses to open a workbook whose sheet name overruns.
    expect(workbook.worksheets[1].name).toHaveLength(31);
  });
});

describe('money', () => {
  it('writes Baht as a number the reader can sum, with ฿ in the format', async () => {
    const workbook = await open(doc());
    const cell = workbook.getWorksheet('Income by event')?.getCell('C2');
    expect(cell?.value).toBe(1070);
    expect(cell?.numFmt).toContain('฿');
    expect(cell?.numFmt).toContain('#,##0.00');
  });

  it('leaves money the reader may not see EMPTY, never as zero', async () => {
    // A 0 in a revenue column is a claim the event earned nothing (US-RPT-12).
    const workbook = await open(
      doc({
        table: {
          columns: [
            { header: 'Event', kind: 'text' },
            { header: 'Revenue (THB)', kind: 'money' },
          ],
          rows: [['Staff View', null]],
        },
      }),
    );
    const cell = workbook.getWorksheet('Income by event')?.getCell('B2');
    expect(cell?.value).toBeNull();
    expect(cell?.value).not.toBe(0);
  });

  it('keeps a refund negative', async () => {
    const workbook = await open(
      doc({
        table: {
          columns: [{ header: 'Amount (THB)', kind: 'money' }],
          rows: [[-125_000]],
        },
      }),
    );
    expect(workbook.getWorksheet('Income by event')?.getCell('A2').value).toBe(
      -1250,
    );
  });
});

describe('percentages and ratios', () => {
  it('stores a percentage as the fraction Excel’s % format expects', async () => {
    // 80 in the API's units is 0.8 to a spreadsheet: stored otherwise, the
    // cell would display 8000%.
    const workbook = await open(
      doc({
        table: {
          columns: [{ header: 'Attendance %', kind: 'percent' }],
          rows: [[80]],
        },
      }),
    );
    const cell = workbook.getWorksheet('Income by event')?.getCell('A2');
    expect(cell?.value).toBe(0.8);
    expect(cell?.numFmt).toBe('0%');
  });

  it('keeps a decimal place when the percentage has one', async () => {
    const workbook = await open(
      doc({
        table: {
          columns: [{ header: 'Attendance %', kind: 'percent' }],
          rows: [[12.5]],
        },
      }),
    );
    const cell = workbook.getWorksheet('Income by event')?.getCell('A2');
    expect(cell?.value).toBe(0.125);
    expect(cell?.numFmt).toBe('0.0%');
  });

  it('writes a return as a multiple', async () => {
    const workbook = await open(
      doc({
        table: {
          columns: [{ header: 'Return', kind: 'ratio' }],
          rows: [[4]],
        },
      }),
    );
    const cell = workbook.getWorksheet('Income by event')?.getCell('A2');
    expect(cell?.value).toBe(4);
    expect(cell?.numFmt).toContain('×');
  });
});

describe('dates', () => {
  it('writes a calendar day as the Bangkok day, not the server’s', async () => {
    // exceljs serialises a Date as a UTC serial, so 20:00 UTC on the 17th has
    // to be shifted here or the workbook would show the 17th.
    const workbook = await open(doc());
    const cell = workbook.getWorksheet('Income by event')?.getCell('B2');
    expect(cell?.value).toEqual(new Date(Date.UTC(2026, 6, 18)));
    expect(cell?.numFmt).toBe('yyyy-mm-dd');
  });

  it('writes an instant as the Bangkok wall clock', async () => {
    const workbook = await open(
      doc({
        table: {
          columns: [{ header: 'When', kind: 'instant' }],
          rows: [[new Date('2026-07-18T09:30:00.000Z')]],
        },
      }),
    );
    const cell = workbook.getWorksheet('Income by event')?.getCell('A2');
    expect(cell?.value).toEqual(new Date(Date.UTC(2026, 6, 18, 16, 30)));
    expect(cell?.numFmt).toBe('yyyy-mm-dd hh:mm');
  });
});

describe('text', () => {
  it('preserves Thai exactly', async () => {
    const workbook = await open(
      doc({
        table: {
          columns: [{ header: 'Event', kind: 'text' }],
          rows: [['มหกรรมเทคโนโลยีกรุงเทพ']],
        },
      }),
    );
    expect(workbook.getWorksheet('Income by event')?.getCell('A2').value).toBe(
      'มหกรรมเทคโนโลยีกรุงเทพ',
    );
  });

  it('finishes a phrase that carries money in the workbook’s own ฿', async () => {
    // A fixed discount code's terms. The cell is text — "฿200 off" cannot be
    // summed — but it must read like the money columns beside it, not like
    // the CSV's bare 200.00.
    const workbook = await open(
      doc({
        table: {
          columns: [{ header: 'Terms', kind: 'text' }],
          rows: [[{ satang: 20_000, suffix: 'off' }]],
        },
      }),
    );
    expect(workbook.getWorksheet('Income by event')?.getCell('A2').value).toBe(
      '฿200 off',
    );
  });

  it('never lets stored text become a formula', async () => {
    // A buyer who names themselves `=HYPERLINK(...)` would otherwise have it
    // run the moment an accountant opens the file.
    const workbook = await open(
      doc({
        table: {
          columns: [{ header: 'Payer', kind: 'text' }],
          rows: [['=HYPERLINK("http://evil.example")']],
        },
      }),
    );
    const cell = workbook.getWorksheet('Income by event')?.getCell('A2');
    expect(cell?.type).toBe(3); // ValueType.String
    expect(cell?.formula).toBeUndefined();
  });
});

describe('the summary sheet', () => {
  it('says what was asked for and when the figures were taken', async () => {
    const workbook = await open(doc());
    const said = saidOn(workbook.getWorksheet('Summary') as Worksheet);
    expect(said).toContain('Income');
    expect(said).toContain('Generated Sep 22, 2026, 14:05 (Asia/Bangkok)');
    expect(said).toContain('Period');
    expect(said).toContain('Jul 1, 2026 – Jul 31, 2026');
    expect(said).toContain('Event');
    expect(said).toContain('All events');
  });

  it('carries the key figures as typed numbers, not as sentences', async () => {
    const workbook = await open(doc());
    const summary = workbook.getWorksheet('Summary');
    const said = saidOn(summary as Worksheet);
    expect(said).toContain('Gross revenue');
    // The figure is the number 1070 with a ฿ format — the same rule as a row.
    const gross = said.indexOf('Gross revenue');
    expect(gross).toBeGreaterThanOrEqual(0);
    let found = false;
    summary?.eachRow((row) => {
      if (row.getCell(1).value === 'Gross revenue') {
        expect(row.getCell(2).value).toBe(1070);
        expect(row.getCell(2).numFmt).toContain('฿');
        found = true;
      }
    });
    expect(found).toBe(true);
  });

  it('owns up when the export hit its ceiling', async () => {
    const workbook = await open(doc({ matched: 9000 }));
    const said = saidOn(workbook.getWorksheet('Summary') as Worksheet).join(
      ' ',
    );
    expect(said).toContain('9,000');
    expect(said.toLowerCase()).toContain('first');
  });

  it('says nothing about truncation when every matching row is in the file', async () => {
    const workbook = await open(doc());
    const said = saidOn(workbook.getWorksheet('Summary') as Worksheet).join(
      ' ',
    );
    expect(said.toLowerCase()).not.toContain('first 1 ');
  });
});

describe('an empty report', () => {
  it('still produces a readable workbook', async () => {
    const workbook = await open(
      doc({
        table: { columns: [{ header: 'Event', kind: 'text' }], rows: [] },
        matched: 0,
      }),
    );
    expect(workbook.worksheets).toHaveLength(2);
    expect(workbook.getWorksheet('Income by event')?.getCell('A1').value).toBe(
      'Event',
    );
  });
});
