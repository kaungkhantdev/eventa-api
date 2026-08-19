import { DomainException } from '../../common/errors/domain.exception';
import { DiscountsPolicy } from './discounts.policy';
import type { DiscountSnapshot } from './discounts.types';

const policy = new DiscountsPolicy();
const NOW = new Date('2026-06-01T00:00:00Z');
const PAST = new Date('2026-05-01T00:00:00Z');
const FUTURE = new Date('2026-07-01T00:00:00Z');

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

describe('DiscountsPolicy', () => {
  describe('normaliseCode (US-TKT-07)', () => {
    it('stores codes uppercase so matching is case-insensitive', () => {
      expect(policy.normaliseCode('  promo42 ')).toBe('PROMO42');
    });

    it('refuses characters that cannot be read off a poster', () => {
      expect(status(thrown(() => policy.normaliseCode('promo 42!')))).toBe(422);
    });

    it('refuses a code that is too short or too long', () => {
      expect(status(thrown(() => policy.normaliseCode('AB')))).toBe(422);
      expect(status(thrown(() => policy.normaliseCode('A'.repeat(25))))).toBe(
        422,
      );
    });
  });

  describe('assertValue (US-TKT-07)', () => {
    it('accepts 1–100 percent', () => {
      expect(thrown(() => policy.assertValue('percent', 25))).toBeUndefined();
      expect(thrown(() => policy.assertValue('percent', 100))).toBeUndefined();
    });

    it('refuses a percentage outside 1–100', () => {
      expect(status(thrown(() => policy.assertValue('percent', 0)))).toBe(422);
      expect(status(thrown(() => policy.assertValue('percent', 101)))).toBe(
        422,
      );
    });

    it('requires a fixed amount of at least one satang', () => {
      expect(thrown(() => policy.assertValue('fixed', 30000))).toBeUndefined();
      expect(status(thrown(() => policy.assertValue('fixed', 0)))).toBe(422);
    });
  });

  describe('assertLimits (US-TKT-07)', () => {
    it('refuses a per-person limit above the total usage limit', () => {
      const err = thrown(() => policy.assertLimits(500, 600));
      expect(status(err)).toBe(422);
      expect(message(err)).toMatch(/per-person/i);
    });

    it('allows a per-person limit under the total', () => {
      expect(thrown(() => policy.assertLimits(500, 2))).toBeUndefined();
    });

    it('treats 0 as unlimited on either side', () => {
      expect(thrown(() => policy.assertLimits(0, 5))).toBeUndefined();
      expect(thrown(() => policy.assertLimits(5, 0))).toBeUndefined();
    });
  });

  describe('assertWindow (US-TKT-07)', () => {
    it('refuses an end before the start', () => {
      expect(status(thrown(() => policy.assertWindow(FUTURE, PAST, NOW)))).toBe(
        422,
      );
    });

    it('refuses a window that has already ended', () => {
      const err = thrown(() => policy.assertWindow(null, PAST, NOW));
      expect(status(err)).toBe(422);
      expect(message(err)).toMatch(/expired/i);
    });

    it('accepts a window that is still to come', () => {
      expect(
        thrown(() => policy.assertWindow(FUTURE, null, NOW)),
      ).toBeUndefined();
    });
  });

  describe('assertChangeAllowedAfterUse (US-TKT-08)', () => {
    const used = code({ used: 342 });

    it('refuses lowering the usage limit below redemptions already made', () => {
      const err = thrown(() =>
        policy.assertChangeAllowedAfterUse(used, { redemptionLimit: 300 }),
      );
      expect(status(err)).toBe(422);
      expect(message(err)).toMatch(/342/);
    });

    it('refuses changing the code text once it has been redeemed', () => {
      const err = thrown(() =>
        policy.assertChangeAllowedAfterUse(used, { code: 'NEWCODE' }),
      );
      expect(status(err)).toBe(409);
      expect(message(err)).toMatch(/new code/i);
    });

    it('refuses changing its value once it has been redeemed', () => {
      expect(
        status(
          thrown(() => policy.assertChangeAllowedAfterUse(used, { value: 30 })),
        ),
      ).toBe(409);
    });

    it('allows changing the value while it has never been redeemed', () => {
      expect(
        thrown(() =>
          policy.assertChangeAllowedAfterUse(code({ used: 0 }), { value: 30 }),
        ),
      ).toBeUndefined();
    });

    it('allows narrowing scope and window on a redeemed code', () => {
      expect(
        thrown(() =>
          policy.assertChangeAllowedAfterUse(used, {
            eventId: 'e1',
            validUntil: FUTURE,
            minOrderSatang: 100000,
          }),
        ),
      ).toBeUndefined();
    });
  });

  describe('resolveStatus (US-TKT-10)', () => {
    it('is Scheduled until the start date arrives, then Active', () => {
      expect(policy.resolveStatus(code({ validFrom: FUTURE }), NOW)).toBe(
        'scheduled',
      );
      expect(policy.resolveStatus(code({ validFrom: PAST }), NOW)).toBe(
        'active',
      );
    });

    it('expires once the window closes', () => {
      expect(policy.resolveStatus(code({ validUntil: PAST }), NOW)).toBe(
        'expired',
      );
    });

    it('expires the moment the final redemption lands', () => {
      expect(
        policy.resolveStatus(code({ used: 500, redemptionLimit: 500 }), NOW),
      ).toBe('expired');
    });

    it('treats a 0 usage limit as unlimited', () => {
      expect(
        policy.resolveStatus(code({ used: 9999, redemptionLimit: 0 }), NOW),
      ).toBe('active');
    });

    it('never derives a disabled code back on — only the organizer does that', () => {
      expect(policy.resolveStatus(code({ status: 'disabled' }), NOW)).toBe(
        'disabled',
      );
    });
  });

  describe('assertRevivable (US-TKT-10)', () => {
    it('refuses to switch on a code whose window has passed', () => {
      const err = thrown(() =>
        policy.assertRevivable(
          code({ status: 'disabled', validUntil: PAST }),
          NOW,
        ),
      );
      expect(status(err)).toBe(409);
      expect(message(err)).toMatch(/dates|usage limit/i);
    });

    it('refuses to switch on a code that has used up its limit', () => {
      expect(
        status(
          thrown(() =>
            policy.assertRevivable(
              code({ status: 'disabled', used: 10, redemptionLimit: 10 }),
              NOW,
            ),
          ),
        ),
      ).toBe(409);
    });

    it('allows switching on a code that still has room and time', () => {
      expect(
        thrown(() => policy.assertRevivable(code({ status: 'disabled' }), NOW)),
      ).toBeUndefined();
    });
  });
});
