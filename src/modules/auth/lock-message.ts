const SECONDS_PER_MINUTE = 60;

/**
 * What was attempted too often. The same lock guards sign-in and the forgotten-
 * password form, and telling somebody who was resetting a password that they
 * made too many SIGN-IN attempts sends them to a screen they never touched.
 */
export type LockedAttempt = 'sign-in' | 'reset';

const ATTEMPT_NOUN: Record<LockedAttempt, string> = {
  'sign-in': 'sign-in attempts',
  reset: 'password-reset attempts',
};

/**
 * What a locked-out person is told, including how long is left (US-ACC-12).
 *
 * "Try again later" is the one instruction they cannot act on — a minute and a
 * day look the same, so they either give up on an account they own or keep
 * hammering the form. The server knows the lock's remaining TTL, so it says it.
 *
 * A precise wait does concede that the lock is real, rather than leaving an
 * attacker to guess. That is a weak secret: the 429 already tells them, and the
 * cost of keeping it is paid entirely by people who have simply mistyped their
 * own password five times.
 *
 * No password reset is offered. `assertNotLocked` runs before any credential is
 * read and the reset flow does not clear the lock, so the old wording named a
 * remedy that could not work while it was showing.
 *
 * Rounded UP: refusing somebody at the moment they were told to return is worse
 * than letting them in a little early.
 */
export function lockedMessage(
  secondsRemaining: number,
  attempt: LockedAttempt = 'sign-in',
): string {
  const what = ATTEMPT_NOUN[attempt];
  if (!Number.isFinite(secondsRemaining) || secondsRemaining <= 0) {
    return `Too many ${what}. Please try again later.`;
  }
  const minutes = Math.ceil(secondsRemaining / SECONDS_PER_MINUTE);
  const unit = minutes === 1 ? 'minute' : 'minutes';
  return `Too many ${what}. Try again in ${minutes} ${unit}.`;
}
