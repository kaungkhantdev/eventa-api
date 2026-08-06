import { CSV_MIME, UTF8_BOM, toCsv } from './csv';

describe('CSV export', () => {
  it('writes a header and one line per row', () => {
    const csv = toCsv(
      ['a', 'b'],
      [
        ['1', '2'],
        ['3', '4'],
      ],
    );
    expect(stripBom(csv)).toBe('a,b\n1,2\n3,4\n');
  });

  it('opens with a UTF-8 BOM so Thai names render in a spreadsheet', () => {
    // Without the BOM, Excel reads the file as the local codepage and Thai
    // turns into mojibake — the one thing the story explicitly asks for.
    const csv = toCsv(['name'], [['อนันต์ สุขสวัสดิ์']]);
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    expect(csv).toContain('อนันต์ สุขสวัสดิ์');
  });

  it('quotes a value containing a comma so it stays one column', () => {
    expect(stripBom(toCsv(['a'], [['Bangkok, Thailand']]))).toBe(
      'a\n"Bangkok, Thailand"\n',
    );
  });

  it('doubles an embedded quote rather than breaking the row', () => {
    expect(stripBom(toCsv(['a'], [['He said "hi"']]))).toBe(
      'a\n"He said ""hi"""\n',
    );
  });

  it('quotes a value containing a newline', () => {
    expect(stripBom(toCsv(['a'], [['one\ntwo']]))).toBe('a\n"one\ntwo"\n');
  });

  it('neutralises a value a spreadsheet would execute as a formula', () => {
    // `=`, `+`, `-` and `@` lead a formula in Excel and Sheets; an attacker-
    // supplied buyer name must not become one when the accountant opens it.
    expect(stripBom(toCsv(['a'], [['=1+1']]))).toBe(`a\n"'=1+1"\n`);
    expect(stripBom(toCsv(['a'], [['@SUM(A1)']]))).toBe(`a\n"'@SUM(A1)"\n`);
    expect(stripBom(toCsv(['a'], [['+1']]))).toBe(`a\n"'+1"\n`);
  });

  it('leaves an ordinary negative number alone', () => {
    // A minus sign leads a formula too, but a real figure must stay a figure.
    expect(stripBom(toCsv(['a'], [[-700]]))).toBe('a\n-700\n');
  });

  it('renders a null as an empty cell, not the word null', () => {
    expect(stripBom(toCsv(['a', 'b'], [[null, 'x']]))).toBe('a,b\n,x\n');
  });

  it('declares its charset in the MIME type', () => {
    expect(CSV_MIME).toBe('text/csv; charset=utf-8');
  });
});

function stripBom(value: string): string {
  return value.startsWith(UTF8_BOM) ? value.slice(UTF8_BOM.length) : value;
}
