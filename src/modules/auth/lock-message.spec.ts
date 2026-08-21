import { lockedMessage } from './lock-message';

/**
 * "Try again later" is the one thing a locked-out person cannot act on: they
 * have no way to tell a minute from a day, so they either give up or hammer the
 * form. The server knows exactly how long is left, so it says.
 *
 * It no longer offers a password reset either. The lock is checked before any
 * credential is read, so a reset does not lift it — the old wording sent people
 * down a path that could not work while they were locked out.
 */
describe('lockedMessage', () => {
  it('says how long is left, in whole minutes', () => {
    expect(lockedMessage(900)).toBe(
      'Too many sign-in attempts. Try again in 15 minutes.',
    );
  });

  it('rounds a part-minute up, so the wait is never understated', () => {
    // 61s is "2 minutes": telling somebody 1 and refusing them at 61 seconds is
    // worse than telling them 2 and letting them in early.
    expect(lockedMessage(61)).toBe(
      'Too many sign-in attempts. Try again in 2 minutes.',
    );
  });

  it('says one minute in the singular', () => {
    expect(lockedMessage(60)).toBe(
      'Too many sign-in attempts. Try again in 1 minute.',
    );
  });

  it('does not promise a fraction of a minute', () => {
    expect(lockedMessage(5)).toBe(
      'Too many sign-in attempts. Try again in 1 minute.',
    );
  });

  /**
   * Redis can report -1 (no expiry) or -2 (no such key), and a race can leave
   * the lock expiring between the check and the read. None of those should
   * produce "try again in -1 minutes".
   */
  describe('when the remaining time is not a usable number', () => {
    it.each([0, -1, -2])(
      'falls back to a plain refusal for a TTL of %s',
      (ttl) => {
        expect(lockedMessage(ttl)).toBe(
          'Too many sign-in attempts. Please try again later.',
        );
      },
    );
  });

  it('never mentions resetting a password', () => {
    // The lock is checked before credentials are read, so a reset cannot lift
    // it. Suggesting one would be advice that does not work.
    for (const ttl of [900, 60, 5, 0, -2]) {
      expect(lockedMessage(ttl)).not.toMatch(/reset/i);
    }
  });
});
