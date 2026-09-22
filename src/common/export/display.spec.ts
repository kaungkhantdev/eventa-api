import { displayCell, generatedLine } from './display';

/**
 * A cell as a PERSON reads it (US-RPT-11).
 *
 * The other half of `toCsvTable`: the same typed cell, spelled for the PDF and
 * for the workbook's summary lines instead of for a spreadsheet formula.
 */

describe('money', () => {
  it('writes Baht the way the product writes it everywhere else', () => {
    expect(displayCell('money', 107_000)).toBe('฿1,070');
    expect(displayCell('money', 107_050)).toBe('฿1,070.50');
  });

  it('puts a refund’s minus in front of the symbol, not inside the figure', () => {
    expect(displayCell('money', -125_000)).toBe('-฿1,250');
  });

  it('shows money the reader may not see as a dash, never as ฿0', () => {
    // "You may not see this" and "it was free" are different facts.
    expect(displayCell('money', null)).toBe('—');
    expect(displayCell('money', 0)).toBe('฿0');
  });
});

describe('figures', () => {
  it('writes a percentage with its sign, keeping a fraction only when there is one', () => {
    expect(displayCell('percent', 80)).toBe('80%');
    expect(displayCell('percent', 12.5)).toBe('12.5%');
  });

  it('writes a return as the multiple the screen shows', () => {
    expect(displayCell('ratio', 4)).toBe('×4.0');
  });

  it('groups a count, because four figures unbroken are hard to read', () => {
    expect(displayCell('count', 1_340)).toBe('1,340');
  });

  it('shows a figure that does not exist as a dash', () => {
    expect(displayCell('percent', null)).toBe('—');
    expect(displayCell('ratio', null)).toBe('—');
    expect(displayCell('count', null)).toBe('—');
  });
});

describe('time', () => {
  it('reads a calendar day in Bangkok, not wherever the server happens to be', () => {
    // 20:00 UTC on the 17th is 03:00 on the 18th in Bangkok — the day the
    // organizer means.
    expect(displayCell('day', new Date('2026-07-17T20:00:00.000Z'))).toBe(
      'Jul 18, 2026',
    );
  });

  it('keeps the time of day on a ledger instant, in Bangkok', () => {
    expect(displayCell('instant', new Date('2026-07-18T09:30:00.000Z'))).toBe(
      'Jul 18, 2026, 16:30',
    );
  });

  it('says when the file was made, and in which timezone', () => {
    // US-RPT-11: the file records the moment the figures were taken.
    expect(generatedLine(new Date('2026-09-22T07:05:00.000Z'))).toBe(
      'Generated Sep 22, 2026, 14:05 (Asia/Bangkok)',
    );
  });
});

describe('text', () => {
  it('capitalises a raw status token for a human-facing file', () => {
    expect(displayCell('status', 'completed')).toBe('Completed');
  });

  it('leaves free text exactly as it is, Thai included', () => {
    expect(displayCell('text', 'มหกรรมเทคโนโลยีกรุงเทพ')).toBe(
      'มหกรรมเทคโนโลยีกรุงเทพ',
    );
  });

  it('shows an absent name as a dash', () => {
    expect(displayCell('text', null)).toBe('—');
  });
});

describe('money inside a phrase', () => {
  it('spells the amount the way the rest of the file spells money', () => {
    // A fixed-amount discount code's terms. `฿200 off` is what the screen
    // says and what the money columns beside it say — never the spreadsheet's
    // bare `200.00`, which is this file's one chance to contradict itself.
    expect(displayCell('text', { satang: 20_000, suffix: 'off' })).toBe(
      '฿200 off',
    );
  });

  it('keeps the satang when the amount has them', () => {
    expect(displayCell('text', { satang: 20_050, suffix: 'off' })).toBe(
      '฿200.50 off',
    );
  });
});
