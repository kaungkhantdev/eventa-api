/** Stable, machine-readable error codes carried in the error envelope. */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  /**
   * An attendee edit named an address another attendee record already holds
   * (US-REG-08). Its own code, not plain `CONFLICT`, because the remedy is
   * specific — merge the two records — and the same route answers `CONFLICT`
   * for the unrelated case of a form opened before somebody else's edit.
   */
  ATTENDEE_EMAIL_IN_USE: 'ATTENDEE_EMAIL_IN_USE',
  /**
   * The code texted to confirm a new phone number is gone — it timed out, or
   * it spent its attempts (US-DISC-11 AC3). Its own code, not plain
   * `VALIDATION_ERROR`, because the remedy differs from the one a mistyped
   * code gets: there is nothing left to retype, and the only way forward is to
   * ask for a new code. The settings page shows "Send a new code" for this and
   * an error under the input for the other, so it has to be able to tell them
   * apart without matching on a sentence.
   */
  PHONE_CODE_EXPIRED: 'PHONE_CODE_EXPIRED',
  /**
   * A booking's create-your-account link (US-DISC-15) is malformed, forged,
   * expired, not a claim link at all, or names an order that is gone or no
   * longer carries the address it was sent to. (A link already USED is not
   * this: its account exists, so it is told to sign in, 409.) Its own code,
   * not plain `VALIDATION_ERROR`, because the remedy differs from the one a
   * refused password gets: nothing typed into the page can fix it, and the way
   * forward is a new link from the booking confirmation. Both answer 400 on
   * the claim route, so the status alone cannot tell them apart.
   */
  CLAIM_LINK_INVALID: 'CLAIM_LINK_INVALID',
  RATE_LIMITED: 'RATE_LIMITED',
  EMAIL_NOT_CONFIRMED: 'EMAIL_NOT_CONFIRMED',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
