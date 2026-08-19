import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { TicketEligibilityPolicy } from './ticket-eligibility.policy';
import type { TicketEligibility } from './ports/ticket-eligibility.port';

const NOW = new Date('2026-07-31T00:00:00.000Z');
const HOUR = 60 * 60 * 1000;

/** A sellable tier by default: on sale, no window, per-order 1–8. */
const salesInfo = (
  overrides: Partial<TicketEligibility> = {},
): TicketEligibility => ({
  status: 'onsale',
  salesStartAt: null,
  salesEndAt: null,
  minPerOrder: 1,
  maxPerOrder: 8,
  ...overrides,
});

/** Run `fn`, asserting it throws a DomainException, and return that exception. */
function caught(fn: () => void): DomainException {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(DomainException);
    return err as DomainException;
  }
  throw new Error('expected the call to throw a DomainException');
}

describe('TicketEligibilityPolicy', () => {
  const policy = new TicketEligibilityPolicy();

  describe('assertPurchasable — status must be on sale', () => {
    it('passes a plain on-sale tier', () => {
      expect(() => policy.assertPurchasable(salesInfo(), 2, NOW)).not.toThrow();
    });

    it.each(['scheduled', 'paused', 'soldout'] as const)(
      'rejects a %s tier as a 409 conflict',
      (status) => {
        const err = caught(() =>
          policy.assertPurchasable(salesInfo({ status }), 1, NOW),
        );
        expect(err.getStatus()).toBe(HttpStatus.CONFLICT);
        expect(err.code).toBe('CONFLICT');
      },
    );

    it('names the sold-out state in the message', () => {
      const err = caught(() =>
        policy.assertPurchasable(salesInfo({ status: 'soldout' }), 1, NOW),
      );
      expect(err.message).toMatch(/sold out/i);
    });

    it('checks status before quantity (state conflict wins over a bad quantity)', () => {
      const err = caught(() =>
        policy.assertPurchasable(
          salesInfo({ status: 'paused', maxPerOrder: 2 }),
          5,
          NOW,
        ),
      );
      expect(err.getStatus()).toBe(HttpStatus.CONFLICT);
    });
  });

  describe('assertPurchasable — sales window', () => {
    it('rejects before salesStartAt (409)', () => {
      const err = caught(() =>
        policy.assertPurchasable(
          salesInfo({ salesStartAt: new Date(NOW.getTime() + HOUR) }),
          1,
          NOW,
        ),
      );
      expect(err.getStatus()).toBe(HttpStatus.CONFLICT);
      expect(err.message).toMatch(/started|open/i);
    });

    it('rejects after salesEndAt (409)', () => {
      const err = caught(() =>
        policy.assertPurchasable(
          salesInfo({ salesEndAt: new Date(NOW.getTime() - HOUR) }),
          1,
          NOW,
        ),
      );
      expect(err.getStatus()).toBe(HttpStatus.CONFLICT);
      expect(err.message).toMatch(/ended|closed/i);
    });

    it('accepts now inside the window, boundaries inclusive', () => {
      expect(() =>
        policy.assertPurchasable(
          salesInfo({ salesStartAt: NOW, salesEndAt: NOW }),
          1,
          NOW,
        ),
      ).not.toThrow();
    });

    it('treats an unset bound as open-ended', () => {
      expect(() =>
        policy.assertPurchasable(
          salesInfo({ salesStartAt: new Date(NOW.getTime() - HOUR) }),
          1,
          NOW,
        ),
      ).not.toThrow();
      expect(() =>
        policy.assertPurchasable(
          salesInfo({ salesEndAt: new Date(NOW.getTime() + HOUR) }),
          1,
          NOW,
        ),
      ).not.toThrow();
    });
  });

  describe('assertPurchasable — per-order min/max', () => {
    it('rejects a quantity below minPerOrder (422)', () => {
      const err = caught(() =>
        policy.assertPurchasable(salesInfo({ minPerOrder: 2 }), 1, NOW),
      );
      expect(err.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.message).toMatch(/at least 2/i);
    });

    it('rejects a quantity above maxPerOrder even when within the global cap (422)', () => {
      const err = caught(() =>
        policy.assertPurchasable(salesInfo({ maxPerOrder: 4 }), 6, NOW),
      );
      expect(err.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.message).toMatch(/at most 4/i);
    });

    it('accepts the min and max boundaries', () => {
      const info = salesInfo({ minPerOrder: 2, maxPerOrder: 4 });
      expect(() => policy.assertPurchasable(info, 2, NOW)).not.toThrow();
      expect(() => policy.assertPurchasable(info, 4, NOW)).not.toThrow();
    });
  });

  describe('assertOnSale — reserved-seat tier gate (no per-order bound)', () => {
    it('passes an on-sale tier inside its window', () => {
      expect(() =>
        policy.assertOnSale(
          salesInfo({
            salesStartAt: new Date(NOW.getTime() - HOUR),
            salesEndAt: new Date(NOW.getTime() + HOUR),
          }),
          NOW,
        ),
      ).not.toThrow();
    });

    it('rejects a non-on-sale tier (409)', () => {
      const err = caught(() =>
        policy.assertOnSale(salesInfo({ status: 'paused' }), NOW),
      );
      expect(err.getStatus()).toBe(HttpStatus.CONFLICT);
    });

    it('rejects a tier outside its window (409)', () => {
      const err = caught(() =>
        policy.assertOnSale(
          salesInfo({ salesEndAt: new Date(NOW.getTime() - HOUR) }),
          NOW,
        ),
      );
      expect(err.getStatus()).toBe(HttpStatus.CONFLICT);
    });

    it('ignores per-order bounds (they belong to order composition)', () => {
      expect(() =>
        policy.assertOnSale(salesInfo({ minPerOrder: 3, maxPerOrder: 4 }), NOW),
      ).not.toThrow();
    });
  });
});
