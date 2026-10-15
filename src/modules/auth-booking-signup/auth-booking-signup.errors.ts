import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { ErrorCode } from '../../common/errors/error-codes';

/**
 * The refusals creating an account from a booking can give (US-DISC-15),
 * named once because the link request, the link check and the claim all give
 * them in the same words — the page shows each sentence exactly as sent.
 */

const SIGN_IN_INSTEAD = 'An account already uses this email. Sign in instead.';

const ACCOUNTS_UNAVAILABLE =
  'Attendee accounts are unavailable right now. Please try again later.';

/** The address already has an attendee account: never a second one (409). */
export function signInInstead(): DomainException {
  return DomainException.conflict(SIGN_IN_INSTEAD);
}

/**
 * The platform organization is missing. It is seeded by migration 0026, so
 * this is a broken deployment — said out loud, as plain sign-up says it.
 */
export function attendeeAccountsUnavailable(): DomainException {
  return new DomainException(
    ErrorCode.INTERNAL_ERROR,
    ACCOUNTS_UNAVAILABLE,
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}
