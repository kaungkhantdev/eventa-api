import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { ATTENDEE_ACCOUNTS_UNAVAILABLE } from '../../common/tenancy/platform-org';
import {
  INVALID_CLAIM_LINK,
  SIGN_IN_INSTEAD,
} from '../../common/constants/auth-booking-signup.constants';

/**
 * The refusals creating an account from a booking can give (US-DISC-15),
 * named once because the link request, the link check and the claim all give
 * them in the same words — the page shows each sentence exactly as sent.
 */

/** The address already has an attendee account: never a second one (409). */
export function signInInstead(): DomainException {
  return DomainException.conflict(SIGN_IN_INSTEAD);
}

/** 400, as the contract the web reads promises — with its own code. */
export function invalidClaimLink(): DomainException {
  return new DomainException(
    ErrorCode.CLAIM_LINK_INVALID,
    INVALID_CLAIM_LINK,
    HttpStatus.BAD_REQUEST,
  );
}

/**
 * The platform organization is missing. It is seeded by migration 0026, so
 * this is a broken deployment — said out loud, as plain sign-up says it.
 */
export function attendeeAccountsUnavailable(): DomainException {
  return new DomainException(
    ErrorCode.INTERNAL_ERROR,
    ATTENDEE_ACCOUNTS_UNAVAILABLE,
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}
