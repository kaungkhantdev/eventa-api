import { formatBaht } from './baht';

describe('formatBaht', () => {
  it('drops the decimals on a whole-baht price', () => {
    expect(formatBaht(120_000)).toBe('฿1,200');
  });

  it('keeps the satang when a price is not whole baht', () => {
    expect(formatBaht(12_050)).toBe('฿120.50');
  });

  it('groups thousands', () => {
    expect(formatBaht(1_234_500)).toBe('฿12,345');
  });

  it('renders zero as ฿0 — the caller decides whether to say "Free"', () => {
    expect(formatBaht(0)).toBe('฿0');
  });

  it('rounds a sub-satang fraction to two decimals rather than trailing off', () => {
    expect(formatBaht(999)).toBe('฿9.99');
  });
});
