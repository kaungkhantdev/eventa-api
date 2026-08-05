import { priceOrder } from './checkout-pricing';

const BAHT = 100;
const VAT = 0.07;
const FEE = 0.05;

const price = (o: Partial<Parameters<typeof priceOrder>[0]> = {}) =>
  priceOrder({
    subtotalSatang: 1_000 * BAHT,
    discountSatang: 0,
    serviceFeeRate: FEE,
    vatRate: VAT,
    ...o,
  });

describe('priceOrder (US-DISC-04)', () => {
  it('adds the service fee on top of the ticket subtotal', () => {
    const t = price();
    expect(t.subtotalSatang).toBe(1_000 * BAHT);
    expect(t.serviceFeeSatang).toBe(50 * BAHT);
    expect(t.totalSatang).toBe(1_050 * BAHT);
  });

  it('charges the fee on what is actually paid, not the pre-discount price', () => {
    const t = price({ discountSatang: 200 * BAHT });
    expect(t.serviceFeeSatang).toBe(40 * BAHT); // 5% of ฿800, not of ฿1,000
    expect(t.totalSatang).toBe(840 * BAHT);
  });

  it('restates VAT on the amount actually charged', () => {
    const t = price();
    expect(t.netSatang + t.vatSatang).toBe(t.totalSatang);
    // ฿1,050 gross at 7% → ฿68.69 VAT
    expect(t.vatSatang).toBe(6_869);
  });

  it('adds no fee at all to a free order', () => {
    const t = price({ subtotalSatang: 0 });
    expect(t).toMatchObject({
      subtotalSatang: 0,
      serviceFeeSatang: 0,
      totalSatang: 0,
      vatSatang: 0,
      netSatang: 0,
    });
  });

  it('adds no fee when a code takes the order to nothing', () => {
    const t = price({ discountSatang: 1_000 * BAHT });
    expect(t.serviceFeeSatang).toBe(0);
    expect(t.totalSatang).toBe(0);
  });

  it('never lets a discount push the order below zero', () => {
    const t = price({ subtotalSatang: 250 * BAHT, discountSatang: 300 * BAHT });
    expect(t.discountSatang).toBe(250 * BAHT);
    expect(t.totalSatang).toBe(0);
  });

  it('ignores a negative discount rather than inflating the order', () => {
    const t = price({ discountSatang: -500 });
    expect(t.discountSatang).toBe(0);
    expect(t.totalSatang).toBe(1_050 * BAHT);
  });

  it('rounds the fee down, so rounding never costs the attendee a satang', () => {
    // 5% of ฿99.99 = 499.95 satang → 499, not 500.
    const t = price({ subtotalSatang: 9_999, vatRate: 0 });
    expect(t.serviceFeeSatang).toBe(499);
    expect(t.totalSatang).toBe(10_498);
  });

  it('keeps the books balanced for every combination', () => {
    const rates = [0, 0.05, 0.1];
    const vats = [0, 0.07];
    for (const subtotal of [0, 1, 999, 9_999, 123_456, 5_000_000]) {
      for (const discount of [0, 1, 333, 100_000, subtotal]) {
        for (const feeRate of rates) {
          for (const vatRate of vats) {
            const t = priceOrder({
              subtotalSatang: subtotal,
              discountSatang: discount,
              serviceFeeRate: feeRate,
              vatRate,
            });
            expect(
              t.subtotalSatang - t.discountSatang + t.serviceFeeSatang,
            ).toBe(t.totalSatang);
            expect(t.netSatang + t.vatSatang).toBe(t.totalSatang);
            expect(t.discountSatang).toBeLessThanOrEqual(t.subtotalSatang);
            for (const v of Object.values(t)) {
              expect(v).toBeGreaterThanOrEqual(0);
              expect(Number.isInteger(v)).toBe(true);
            }
          }
        }
      }
    }
  });
});
