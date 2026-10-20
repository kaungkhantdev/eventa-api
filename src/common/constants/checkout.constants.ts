import { orderItems, orders, ticketTypes } from '../../db/schema/index';

/** The checkout module's named constants. */

/**
 * The expiry a reserved seat's hold takes while its registration waits for a
 * decision. A decision, not a clock, ends this hold — and every availability
 * query already reads `expires_at`, so a date no clock reaches keeps the seat
 * off sale without teaching any of them a new rule.
 */
export const DECISION_HOLD_EXPIRY = new Date('9999-12-31T23:59:59Z');

/**
 * Placing the registration (US-DISC-06): one order, one ticket per admission,
 * exactly once.
 *
 * The summary is re-quoted here rather than taken from the request, so what is
 * charged is what the tier and the code are worth at this instant — not what the
 * page showed some minutes ago. Everything then happens inside
 * `CheckoutRepository.placeOrder`'s single transaction, which is also where the
 * confirmation event is written, so an attendee can never end up with a ticket
 * and no email or an email and no ticket.
 *
 * A free order confirms immediately and its tickets are issued. A paid one is
 * placed as `pending` with its seats still held, and the tickets are minted when
 * the payment settles (US-DISC-05) — so nobody holds a QR for something they
 * have not paid for.
 *
 * On an event that requires approval (US-REG-02) no order is ticketed here: a
 * free one is placed waiting for the organizer with its places counted, and a
 * paid one is placed for payment exactly as above — it starts waiting when the
 * money lands. The tickets and the confirmation come with the approval.
 */
/** Said for a bad id and for somebody else's alike — the two must not be
 *  distinguishable, or the endpoint becomes a way to probe for orders. */
export const ORDER_NOT_FOUND = 'That order could not be found.';

export const FREE_LABEL = 'Free';

export const ONSALE = 'onsale';

/** An allocation of 0 means unlimited — mirrors `TicketingPolicy`. */
export const UNLIMITED = 0;

export const GA_SEATING_NOTE = 'Seating is first-come, first-served.';

export const ONLINE_DELIVERY_NOTE =
  'A join link will be emailed to you before the event starts.';

/**
 * Said before anybody pays (US-REG-02): the money is taken now, the ticket
 * comes with the organizer's approval, and a "no" gives the money back.
 */
export const APPROVAL_NOTE =
  "The organizer reviews each registration before confirming it. If yours isn't approved, any payment is refunded in full.";

export const OTHER_TICKET_TYPE =
  'Those seats belong to a different ticket type. Please choose again.';

export const NOT_ON_SALE =
  "Those seats aren't on sale. Please choose different seats.";

/** Fallbacks if a workspace row somehow has none — the Thai statutory rate. */
export const DEFAULT_VAT_RATE = 0.07;

export const DEFAULT_SERVICE_FEE_RATE = 0.05;

/** How a waitlist entry is read, wherever it is read from. */
export const WAITLIST_ENTRY_COLUMNS = {
  order: orders,
  ticketTypeId: orderItems.ticketTypeId,
  ticketTypeName: ticketTypes.name,
  quantity: orderItems.quantity,
};

/**
 * Why money that arrived is going back, as the CODE `payment.refund_required`
 * carries. eventa-worker words each one for the buyer in their own language
 * (`REASONS` in its refund-notice.ts) — an English sentence here landed inside
 * the Thai email. Keep the two lists in step.
 */
export const REFUND_REASON = {
  tierRemoved: 'tier_removed',
  soldOut: 'soldout',
  seatsTaken: 'seats_unavailable',
  seatMismatch: 'seat_mismatch',
  seatsReleased: 'seats_released',
  orderClosed: 'order_closed',
} as const;

/** The two states awaiting a decision — approvable, and rejectable. */
export const AWAITING_DECISION = ['pending', 'waitlisted'] as const;

export const DECIDED_ELSEWHERE =
  'This registration was decided by someone else — refresh to see where it stands.';

/** A payment landed between the organizer reading the list and clicking. */
export const PAID_WHILE_DECIDING =
  'This registration was paid for while you were deciding — refresh to see where it stands.';

export const ACTIVE_HOLD = 'active';

/** A ticket that still admits someone — the set a refund takes back. */
export const LIVE_TICKET_STATUSES = ['issued', 'checked_in'] as const;

export const MAX_NAME = 120;

export const MAX_EMAIL = 254;

export const MAX_PHONE = 24;

export const MAX_CODE = 24;

export const MIN_IDEMPOTENCY_KEY = 8;

export const MAX_IDEMPOTENCY_KEY = 128;

/** Routing key for money that arrived for inventory we could not honour. */
export const PAYMENT_REFUND_REQUIRED = 'payment.refund_required';

/** Routing key for a placed, fully-paid registration (US-DISC-06). */
export const REGISTRATION_CONFIRMED = 'registration.confirmed';

/** Routing key for a sign-up the organizer turned down. */
export const REGISTRATION_REJECTED = 'registration.rejected';

/** Routing key for a seat offered to someone on the waitlist (US-REG-04). */
export const WAITLIST_OFFERED = 'waitlist.offered';

/** Crockford base32 minus I, L, O, U — no character a person can mis-copy. */
export const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const LENGTH = 8;

export const PREFIX = 'ORD';

/** How many fresh references to try before admitting defeat (32^8 collisions). */
export const REFERENCE_ATTEMPTS = 3;

export const REFERENCE_CONSTRAINT = 'uq_orders_org_reference';

/** 32^24 ≈ 1.3e36 — unguessable at any scale a scanner could be brute-forced at. */
export const QR_TOKEN_LENGTH = 24;

export const MS_PER_HOUR = 60 * 60 * 1000;

export const GONE = "This registration isn't available.";

/** Where an attendee opens an order's tickets on the public site. */
export const TICKETS_PATH = '/my/tickets/orders';

/**
 * How long a free registration's place is held while its approval runs. The
 * hold only has to outlive the approval that converts it, and a short expiry
 * means a crash between the two cannot keep a place off sale for long.
 */
export const CONFIRM_HOLD_MS = 5 * 60 * 1000;

/** Nobody chose them: the line did, in order. Recorded as no offerer/decider. */
export const NOBODY = null;

export const STOPPED_EARLY = 'Waitlist auto-offer stopped early';

export const WAITLIST_CLOSED = 'This event does not have a waitlist.';

export const WAITLIST_TICKETS_LEFT =
  'Tickets are still available — book one instead of joining the waitlist.';

export const WAITLIST_RESERVED_SEATING =
  'The waitlist is for general-admission tickets; this event seats people by seat.';
