import { quoteDiscount } from './discount-quote';
import type { DiscountSnapshot } from './discounts.types';

const VAT = 0.07;
const BAHT = 100;

const code = (o: Partial<DiscountSnapshot> = {}): DiscountSnapshot => ({
  id: 'd1',
  code: 'PROMO42',
  type: 'percent',
  value: 25,
  status: 'active',
  eventId: null,
  used: 0,
  redemptionLimit: 0,
  perPersonLimit: 0,
  minOrderSatang: 0,
  validFrom: null,
  validUntil: null,
  ...o,
});

describe('quoteDiscount (US-TKT-11)', () => {
  it('takes 25% off a ฿1,000 order and recalculates VAT on the reduced amount', () => {
    const q = quoteDiscount(
      code({ type: 'percent', value: 25 }),
      1000 * BAHT,
      VAT,
    );
    expect(q.discountSatang).toBe(250 * BAHT);
    expect(q.totalSatang).toBe(750 * BAHT);
    // VAT is embedded in the discounted total, not in the original
    expect(q.vatSatang).toBe(Math.round((750 * BAHT * VAT) / (1 + VAT)));
    expect(q.netSatang + q.vatSatang).toBe(q.totalSatang);
  });

  it('caps a ฿300-off code at a ฿250 order so the total never goes below zero', () => {
    const q = quoteDiscount(
      code({ type: 'fixed', value: 300 * BAHT }),
      250 * BAHT,
      VAT,
    );
    expect(q.discountSatang).toBe(250 * BAHT);
    expect(q.totalSatang).toBe(0);
    expect(q.vatSatang).toBe(0);
    expect(q.netSatang).toBe(0);
  });

  it('takes a fixed amount straight off', () => {
    const q = quoteDiscount(code({ type: 'fixed', value: 30000 }), 100000, VAT);
    expect(q.discountSatang).toBe(30000);
    expect(q.totalSatang).toBe(70000);
  });

  it('never invents a fraction of a satang', () => {
    // 33% of ฿99.99 is not a whole satang — it must round down, never up, so the
    // attendee is never charged less than the order is worth.
    const q = quoteDiscount(code({ type: 'percent', value: 33 }), 9999, VAT);
    expect(Number.isInteger(q.discountSatang)).toBe(true);
    expect(q.discountSatang).toBe(Math.floor((9999 * 33) / 100));
    expect(q.discountSatang + q.totalSatang).toBe(9999);
  });

  it('a 100% code makes the order free without going negative', () => {
    const q = quoteDiscount(code({ type: 'percent', value: 100 }), 50000, VAT);
    expect(q.discountSatang).toBe(50000);
    expect(q.totalSatang).toBe(0);
  });

  it('discounts nothing on a zero-value order', () => {
    const q = quoteDiscount(code({ type: 'fixed', value: 30000 }), 0, VAT);
    expect(q.discountSatang).toBe(0);
    expect(q.totalSatang).toBe(0);
  });

  it('always reports parts that add back up to the original subtotal', () => {
    for (const subtotal of [1, 99, 100, 12345, 9999999]) {
      for (const value of [1, 7, 33, 50, 99, 100]) {
        const q = quoteDiscount(
          code({ type: 'percent', value }),
          subtotal,
          VAT,
        );
        expect(q.discountSatang + q.totalSatang).toBe(subtotal);
        expect(q.netSatang + q.vatSatang).toBe(q.totalSatang);
        expect(q.discountSatang).toBeGreaterThanOrEqual(0);
        expect(q.totalSatang).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
