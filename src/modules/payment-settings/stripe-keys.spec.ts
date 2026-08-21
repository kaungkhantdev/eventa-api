import { assertKeysMatchMode, maskedTail, modeOfKey } from './stripe-keys';

const TEST_PK = 'pk_test_51P9xEventa0aB3kY7cQ';
const TEST_SK = 'sk_test_51P9xEventa7hV6tL1pX';
const LIVE_PK = 'pk_live_51P9xEventa0aB3kY7cQ';
const LIVE_SK = 'sk_live_51P9xEventa7hV6tL1pX';

const refusal = (fn: () => void): string => {
  try {
    fn();
    return '';
  } catch (error) {
    return (error as Error).message;
  }
};

/**
 * The rules that stop an organizer charging real cards by accident.
 *
 * Stripe encodes the mode in the key itself, so a pair can disagree with the
 * toggle above it — and the failure is silent and expensive in both directions:
 * live keys saved under "Test" take real money from real people while the screen
 * says nothing is charged, and test keys saved under "Live" decline every real
 * buyer at an event that has already opened sales.
 */
describe('stripe key rules (US-SET-08)', () => {
  describe('modeOfKey', () => {
    it.each([
      [TEST_PK, 'test'],
      [TEST_SK, 'test'],
      [LIVE_PK, 'live'],
      [LIVE_SK, 'live'],
    ])('reads %s as %s mode', (key, expected) => {
      expect(modeOfKey(key)).toBe(expected);
    });

    // A restricted key is a real Stripe key and carries its mode the same way.
    it.each([
      ['rk_test_abc', 'test'],
      ['rk_live_abc', 'live'],
    ])('reads restricted key %s as %s mode', (key, expected) => {
      expect(modeOfKey(key)).toBe(expected);
    });

    it('returns null for something that is not a Stripe key', () => {
      expect(modeOfKey('hunter2')).toBeNull();
    });
  });

  describe('assertKeysMatchMode', () => {
    it('accepts a matched test pair under test mode', () => {
      expect(() => assertKeysMatchMode('test', TEST_PK, TEST_SK)).not.toThrow();
    });

    it('accepts a matched live pair under live mode', () => {
      expect(() => assertKeysMatchMode('live', LIVE_PK, LIVE_SK)).not.toThrow();
    });

    /** The dangerous direction: real money moving behind a "Test" label. */
    it('refuses live keys saved under test mode', () => {
      expect(
        refusal(() => assertKeysMatchMode('test', LIVE_PK, LIVE_SK)),
      ).toMatch(/live/i);
    });

    it('refuses test keys saved under live mode', () => {
      expect(
        refusal(() => assertKeysMatchMode('live', TEST_PK, TEST_SK)),
      ).toMatch(/test/i);
    });

    // Copy one key, forget to swap the other — easy to do, and it fails at the
    // till rather than here unless it is caught.
    it('refuses a pair whose two halves disagree with each other', () => {
      expect(
        refusal(() => assertKeysMatchMode('test', TEST_PK, LIVE_SK)),
      ).toBeTruthy();
    });

    it('refuses a publishable key in the secret field', () => {
      expect(
        refusal(() => assertKeysMatchMode('test', TEST_PK, TEST_PK)),
      ).toMatch(/secret key/i);
    });

    /**
     * The one that would leak a secret into the browser: `publishableKey` is
     * returned to the page by design, so a secret pasted into it would be
     * shown back and cached wherever that response goes.
     */
    it('refuses a secret key in the publishable field', () => {
      expect(
        refusal(() => assertKeysMatchMode('test', TEST_SK, TEST_SK)),
      ).toMatch(/publishable key/i);
    });

    it('refuses something that is not a Stripe key at all', () => {
      expect(
        refusal(() => assertKeysMatchMode('test', 'nonsense', TEST_SK)),
      ).toBeTruthy();
    });
  });

  /**
   * What the UI shows in place of a stored secret. Never the secret itself, and
   * never enough of it to be useful — the last four only confirm WHICH key is
   * saved, which is the only question the screen has to answer.
   */
  describe('maskedTail', () => {
    it('shows only the last four characters', () => {
      expect(maskedTail(TEST_SK)).toBe('••••L1pX');
    });

    it('never contains the key itself', () => {
      expect(maskedTail(TEST_SK)).not.toContain('sk_test');
    });

    it('is empty when nothing is stored', () => {
      expect(maskedTail(null)).toBe('');
    });

    // A key too short to mask must not fall back to showing all of it.
    it('does not reveal a short value', () => {
      expect(maskedTail('sk_a')).toBe('••••');
    });
  });
});
