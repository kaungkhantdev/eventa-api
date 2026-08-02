import { DomainException } from '../../common/errors/domain.exception';
import { TicketingPolicy } from './ticketing.policy';

const policy = new TicketingPolicy();
const now = new Date('2026-06-01T00:00:00Z');
const status = (e: unknown) => (e as DomainException).getStatus();
const message = (e: unknown) => (e as DomainException).message;
const thrown = (fn: () => void): unknown => {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e;
  }
};

describe('TicketingPolicy', () => {
  describe('assertSalesWindow (US-TKT-01)', () => {
    it('accepts an open-ended window', () => {
      expect(
        thrown(() => policy.assertSalesWindow(null, null)),
      ).toBeUndefined();
      expect(
        thrown(() => policy.assertSalesWindow(new Date(), null)),
      ).toBeUndefined();
    });

    it('rejects an end date before the start, in plain language', () => {
      const err = thrown(() =>
        policy.assertSalesWindow(
          new Date('2026-06-10T00:00:00Z'),
          new Date('2026-06-01T00:00:00Z'),
        ),
      );
      expect(status(err)).toBe(422);
      expect(message(err)).toMatch(/end.*after.*start/i);
    });

    it('rejects an end equal to the start (a zero-length window sells nothing)', () => {
      const at = new Date('2026-06-10T00:00:00Z');
      expect(status(thrown(() => policy.assertSalesWindow(at, at)))).toBe(422);
    });
  });

  describe('assertPerOrderBounds (US-TKT-01)', () => {
    it('accepts a limit within the 8-seat platform cap', () => {
      expect(
        thrown(() => policy.assertPerOrderBounds(1, 8, 100)),
      ).toBeUndefined();
    });

    it('refuses a per-order limit above the platform booking cap', () => {
      const err = thrown(() => policy.assertPerOrderBounds(1, 9, 100));
      expect(status(err)).toBe(422);
      expect(message(err)).toMatch(/8/);
    });

    it('refuses a per-order limit above the quantity available', () => {
      const err = thrown(() => policy.assertPerOrderBounds(1, 6, 5));
      expect(status(err)).toBe(422);
      expect(message(err)).toMatch(/5/);
    });

    it('allows any limit when the quantity is unlimited (0)', () => {
      expect(
        thrown(() => policy.assertPerOrderBounds(1, 8, 0)),
      ).toBeUndefined();
    });

    it('refuses a minimum above the maximum', () => {
      expect(status(thrown(() => policy.assertPerOrderBounds(5, 2, 100)))).toBe(
        422,
      );
    });
  });

  describe('assertWholeBaht (US-TKT-01)', () => {
    it('accepts a whole-baht price', () => {
      expect(thrown(() => policy.assertWholeBaht(89000))).toBeUndefined();
      expect(thrown(() => policy.assertWholeBaht(0))).toBeUndefined();
    });

    it('refuses a price with stray satang', () => {
      const err = thrown(() => policy.assertWholeBaht(89050));
      expect(status(err)).toBe(422);
      expect(message(err)).toMatch(/whole baht/i);
    });
  });

  describe('assertChangeAllowedAfterSales (US-TKT-02)', () => {
    const sold = { sold: 640, priceSatang: 89000, isFree: false };

    it('lets an unsold tier change its price or paid/free setting', () => {
      const unsold = { sold: 0, priceSatang: 89000, isFree: false };
      expect(
        thrown(() =>
          policy.assertChangeAllowedAfterSales(unsold, {
            priceSatang: 50000,
            isFree: true,
          }),
        ),
      ).toBeUndefined();
    });

    it('refuses a price change once tickets have sold, and says what to do instead', () => {
      const err = thrown(() =>
        policy.assertChangeAllowedAfterSales(sold, { priceSatang: 50000 }),
      );
      expect(status(err)).toBe(409);
      expect(message(err)).toMatch(/new ticket type/i);
    });

    it('refuses switching paid/free once tickets have sold', () => {
      expect(
        status(
          thrown(() =>
            policy.assertChangeAllowedAfterSales(sold, { isFree: true }),
          ),
        ),
      ).toBe(409);
    });

    it('allows re-submitting the same price unchanged (an idempotent save)', () => {
      expect(
        thrown(() =>
          policy.assertChangeAllowedAfterSales(sold, {
            priceSatang: 89000,
            isFree: false,
          }),
        ),
      ).toBeUndefined();
    });

    it('always allows description-style changes on a sold tier', () => {
      expect(
        thrown(() =>
          policy.assertChangeAllowedAfterSales(sold, { name: 'VVIP' }),
        ),
      ).toBeUndefined();
    });
  });

  describe('assertQuantityNotBelowSold (US-TKT-02)', () => {
    it('refuses lowering the quantity below the seats already sold', () => {
      const err = thrown(() => policy.assertQuantityNotBelowSold(500, 640));
      expect(status(err)).toBe(422);
      expect(message(err)).toMatch(/640/);
    });

    it('allows raising it', () => {
      expect(
        thrown(() => policy.assertQuantityNotBelowSold(800, 640)),
      ).toBeUndefined();
    });

    it('allows lowering it to exactly the sold count', () => {
      expect(
        thrown(() => policy.assertQuantityNotBelowSold(640, 640)),
      ).toBeUndefined();
    });
  });

  describe('resolveStatus (US-TKT-01/02/03)', () => {
    const base = {
      status: 'onsale' as const,
      sold: 0,
      total: 100,
      salesStartAt: null,
      salesEndAt: null,
    };

    it('is Scheduled while the sales start date is still ahead', () => {
      expect(
        policy.resolveStatus(
          { ...base, salesStartAt: new Date('2026-07-01T00:00:00Z') },
          now,
        ),
      ).toBe('scheduled');
    });

    it('is On sale once the start date has arrived and seats remain', () => {
      expect(
        policy.resolveStatus(
          {
            ...base,
            status: 'scheduled',
            salesStartAt: new Date('2026-05-01T00:00:00Z'),
          },
          now,
        ),
      ).toBe('onsale');
    });

    it('is Sold out when the allocation is exhausted', () => {
      expect(
        policy.resolveStatus({ ...base, sold: 100, total: 100 }, now),
      ).toBe('soldout');
    });

    it('returns to On sale when capacity is raised on a sold-out tier (US-TKT-02)', () => {
      expect(
        policy.resolveStatus(
          { ...base, status: 'soldout', sold: 100, total: 150 },
          now,
        ),
      ).toBe('onsale');
    });

    it('treats an unlimited allocation (0) as never sold out', () => {
      expect(policy.resolveStatus({ ...base, sold: 500, total: 0 }, now)).toBe(
        'onsale',
      );
    });

    it('never derives a paused tier back on sale — only Resume does that', () => {
      expect(policy.resolveStatus({ ...base, status: 'paused' }, now)).toBe(
        'paused',
      );
    });
  });
});
