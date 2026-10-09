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
  RATE_LIMITED: 'RATE_LIMITED',
  EMAIL_NOT_CONFIRMED: 'EMAIL_NOT_CONFIRMED',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
