import { ApiErrorDto } from '../errors/error-envelope';
import type { SendBudget } from '../throttle/resend-throttle.service';

/** The auth-booking-signup module's named constants. */

export const BEARER = 'Bearer';

export const UNKNOWN_DEVICE = 'Unknown device';

export const DEAD_LINK_RESPONSE = {
  description:
    'The link is malformed, expired, not a claim link, no longer matches its booking, or was used by an account that is now gone (code CLAIM_LINK_INVALID) — or the body failed validation',
  type: ApiErrorDto,
};

export const SIGN_IN_INSTEAD =
  'An account already uses this email. Sign in instead.';

/**
 * One sentence for every dead link — malformed, forged, expired, not a claim
 * link, for an order that is gone or whose address has since changed, or used
 * already by an account that is now gone. To the person holding it they are
 * the same link that does not work, and telling them apart would only help
 * somebody probing tokens. A used link whose account still stands is not
 * dead: it is told to sign in instead.
 */
export const INVALID_CLAIM_LINK =
  'This link has expired or is no longer valid. Ask for a new one from your booking confirmation.';

export const ORDER_NOT_FOUND = 'That order could not be found.';

export const BOOKING_NOT_CONFIRMED =
  "This booking isn't confirmed, so there are no tickets to keep in an account yet.";

export const SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * How many claim emails one address may be sent a day, on top of the
 * one-a-minute cool-off. Whoever holds an order id can ask — the booker, not
 * only the buyer, and anybody can book with anybody's address — so the
 * cool-off alone would let a stranger have Eventa mail somebody ~1,440 times a
 * day. A handful covers a buyer whose first link went to spam.
 */
export const CLAIM_LINK_BUDGET: SendBudget = {
  max: 5,
  windowSeconds: SECONDS_PER_DAY,
};

/**
 * The page on the web app the emailed link opens. It shows the booking's name
 * and address and asks only for a password.
 */
export const CLAIM_PAGE = '/portal/register';

/** Where a used link is remembered; the rest of the key is a digest of it. */
export const SPENT_PREFIX = 'booking-claim:spent:';

export const MS_PER_SECOND = 1000;

/**
 * Far longer than any token this API signs, short enough that nobody can make
 * the verifier chew on a megabyte.
 */
export const CLAIM_TOKEN_MAX_LENGTH = 2048;

/** Routing key for a booking's create-your-account email (consumed by eventa-worker). */
export const IDENTITY_BOOKING_ACCOUNT_LINK_REQUESTED =
  'identity.booking_account_link_requested';
