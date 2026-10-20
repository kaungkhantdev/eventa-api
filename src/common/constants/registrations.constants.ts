import { MAX_SEATS_PER_BOOKING } from '../booking/booking.limits';
import { orderStatusEnum } from '../../db/schema/index';

/** The registrations module's named constants. */

export const MAX_NAME = 120;

export const MAX_EMAIL = 254;

export const MAX_PHONE = 24;

/** US-REG-03's own wording, so the panel asks rather than quoting a validator. */
export const SEATS_PER_BOOKING = `Choose between 1 and ${MAX_SEATS_PER_BOOKING} seats per booking.`;

/** A rejection reason is for the organizer's own records and the notice email. */
export const MAX_REJECTION_REASON = 500;

export const DEFAULT_LIMIT = 20;

export const MAX_LIMIT = 100;

export const MAX_SEARCH = 120;

/** The statuses this build is able to publish a field for. */
export const PUBLISHED: ReadonlySet<string> = new Set(
  orderStatusEnum.enumValues,
);

export const APPROVE_BLOCKED_UNPAID =
  "Payment isn't complete yet, so this registration can't be approved.";

export const REJECT_BLOCKED_PAID =
  'Money has been captured for this registration — cancel and refund it instead of rejecting.';

export const REJECT_NEEDS_REFUND_PERMISSION =
  'Rejecting this registration refunds its payment, and refunds need the refund permission — ask an Admin.';

export const ALREADY_REJECTED =
  'This registration was rejected, and a rejection cannot be undone.';

export const NOT_AWAITING =
  'Only a pending or waitlisted registration can be decided.';

export const OFFER_NOT_WAITLISTED =
  'Only someone on the waitlist can be offered a seat.';

export const NEEDS_CONFIRMATION =
  'Rejecting a registration is permanent. Send `confirm=true` to go ahead.';

export const GONE = "This registration isn't available.";

/** The blocker had no message of its own — a race we could not name. */
export const UNAVAILABLE = 'This registration can no longer be approved.';

/** US-REG-04: "promotion is refused and I'm told to free capacity first". */
export const NO_SEAT_FREE =
  'No seat is free on this ticket — raise its capacity, or wait for one to free up.';

/** The provider's own words follow the colon — they are written for a person. */
export const REFUND_DID_NOT_GO_THROUGH =
  'The registration was rejected, but its refund did not go through:';

export const FINISH_FROM_PAYMENTS = 'Issue the refund from Payments.';

/**
 * In place of the words of a failure that was not a refusal — a timeout, an
 * error nothing mapped — whose text is internals, not something to show. A
 * retried rejection asks the provider again under the same key.
 */
export const REFUND_INTERRUPTED =
  'it was interrupted before it could be confirmed. Reject it again to retry the refund, or issue it from Payments.';

/** A sign-up counts once it is confirmed — a pending one may never happen. */
export const COUNTED = 'confirmed';

/** The two states awaiting an organizer, mirroring `registration-decision.ts`. */
export const AWAITING = ['pending', 'waitlisted'] as const;
