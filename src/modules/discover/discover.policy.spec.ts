import { DiscoverPolicy } from './discover.policy';
import type { TierInventory } from './discover.types';

const BAHT = 100;

function tier(o: Partial<TierInventory> = {}): TierInventory {
  return {
    priceSatang: 500 * BAHT,
    isFree: false,
    status: 'onsale',
    sold: 0,
    total: 100,
    ...o,
  };
}

describe('DiscoverPolicy (US-DISC-01)', () => {
  const policy = new DiscoverPolicy();

  describe('resolveBadge', () => {
    it('shows nothing for an event with plenty of seats left', () => {
      expect(policy.resolveBadge([tier({ sold: 10, total: 100 })])).toBeNull();
    });

    it('shows Waitlist once every tier is exhausted', () => {
      expect(
        policy.resolveBadge([
          tier({ sold: 100, total: 100 }),
          tier({ sold: 50, total: 50 }),
        ]),
      ).toBe('waitlist');
    });

    it('does not show Waitlist while one tier still has seats', () => {
      expect(
        policy.resolveBadge([
          tier({ sold: 100, total: 100 }),
          tier({ sold: 0, total: 50 }),
        ]),
      ).toBeNull();
    });

    it('shows Selling fast once 90% of the allocation has gone', () => {
      expect(policy.resolveBadge([tier({ sold: 90, total: 100 })])).toBe(
        'selling_fast',
      );
    });

    it('prefers Waitlist over Selling fast when the last seat goes', () => {
      expect(policy.resolveBadge([tier({ sold: 100, total: 100 })])).toBe(
        'waitlist',
      );
    });

    it('never calls an unlimited tier sold out or selling fast', () => {
      expect(
        policy.resolveBadge([tier({ sold: 10_000, total: 0 })]),
      ).toBeNull();
    });

    it('judges selling fast across the whole event, not one tier', () => {
      // 95 of 200 gone overall — one tier is empty, so the event is not urgent.
      expect(
        policy.resolveBadge([
          tier({ sold: 95, total: 100 }),
          tier({ sold: 0, total: 100 }),
        ]),
      ).toBeNull();
    });

    it('shows nothing for an event with no ticket types at all', () => {
      expect(policy.resolveBadge([])).toBeNull();
    });

    it('ignores a paused tier when deciding the event has sold out', () => {
      // Paused is an organizer's choice, not exhausted stock — no Waitlist badge.
      expect(
        policy.resolveBadge([
          tier({ sold: 100, total: 100 }),
          tier({ status: 'paused', sold: 0, total: 50 }),
        ]),
      ).toBeNull();
    });
  });

  describe('priceFrom', () => {
    it('quotes the cheapest tier still on sale', () => {
      expect(
        policy.priceFrom([
          tier({ priceSatang: 1_500 * BAHT }),
          tier({ priceSatang: 800 * BAHT }),
        ]),
      ).toEqual({ satang: 800 * BAHT, isFree: false });
    });

    it('skips a sold-out cheap tier and quotes what can still be bought', () => {
      expect(
        policy.priceFrom([
          tier({ priceSatang: 300 * BAHT, sold: 50, total: 50 }),
          tier({ priceSatang: 900 * BAHT }),
        ]),
      ).toEqual({ satang: 900 * BAHT, isFree: false });
    });

    it('reports Free when the cheapest way in costs nothing', () => {
      expect(
        policy.priceFrom([
          tier({ priceSatang: 0, isFree: true }),
          tier({ priceSatang: 900 * BAHT }),
        ]),
      ).toEqual({ satang: 0, isFree: true });
    });

    it('quotes no price at all once the event has sold out', () => {
      expect(policy.priceFrom([tier({ sold: 50, total: 50 })])).toBeNull();
    });

    it('quotes no price for an event with no ticket types', () => {
      expect(policy.priceFrom([])).toBeNull();
    });

    it('still quotes a paused tier — it is coming back, not gone', () => {
      expect(
        policy.priceFrom([tier({ status: 'paused', priceSatang: 400 * BAHT })]),
      ).toEqual({ satang: 400 * BAHT, isFree: false });
    });
  });

  describe('label', () => {
    it('renders Free rather than ฿0', () => {
      expect(policy.label({ satang: 0, isFree: true })).toBe('Free');
    });

    it('renders whole baht with a thousands separator and no decimals', () => {
      expect(policy.label({ satang: 1_200 * BAHT, isFree: false })).toBe(
        '฿1,200',
      );
    });

    it('keeps the satang when a price is not a whole baht', () => {
      expect(policy.label({ satang: 12_050, isFree: false })).toBe('฿120.50');
    });

    it('renders nothing when there is no price to quote', () => {
      expect(policy.label(null)).toBeNull();
    });
  });
});
