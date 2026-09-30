import { NotFoundException } from '@nestjs/common';
import { ExportFormatPipe } from './export-format.pipe';

/**
 * Which file the reader asked for (US-RPT-11).
 *
 * The format is part of the path — `income.xlsx` — so an unknown one is a page
 * that does not exist, not a bad parameter. A 404 is what a reader typing
 * `income.json` should get.
 */

describe('the export format in the path', () => {
  const pipe = new ExportFormatPipe();

  it('accepts the three the product offers', () => {
    expect(pipe.transform('csv')).toBe('csv');
    expect(pipe.transform('xlsx')).toBe('xlsx');
    expect(pipe.transform('pdf')).toBe('pdf');
  });

  it('refuses anything else as a route that is not there', () => {
    expect(() => pipe.transform('json')).toThrow(NotFoundException);
    expect(() => pipe.transform('')).toThrow(NotFoundException);
  });
});
