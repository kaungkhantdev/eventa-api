import { vatInclusiveBreakdown } from './vat';

describe('vatInclusiveBreakdown', () => {
  it('splits a VAT-inclusive ฿890 into net ฿831.78 + VAT ฿58.22 at 7%', () => {
    expect(vatInclusiveBreakdown(89000, 0.07)).toEqual({
      grossSatang: 89000,
      netSatang: 83178,
      vatSatang: 5822,
    });
  });

  it('returns all zero for a free ticket', () => {
    expect(vatInclusiveBreakdown(0, 0.07)).toEqual({
      grossSatang: 0,
      netSatang: 0,
      vatSatang: 0,
    });
  });

  it('keeps net + vat exactly equal to gross (rounding is consistent)', () => {
    const b = vatInclusiveBreakdown(12345, 0.07);
    expect(b.netSatang + b.vatSatang).toBe(12345);
  });
});
