import type { orderStatusEnum, paymentStatusEnum } from '../../db/schema';

type OrderStatus = (typeof orderStatusEnum.enumValues)[number];
type PaymentStatus = (typeof paymentStatusEnum.enumValues)[number];

/**
 * "Require approval" with money in it (US-REG-02): the buyer PAYS FIRST, and
 * the registration then waits for the organizer. Approving issues the tickets
 * and the confirmation; rejecting refunds the money. A free registration simply
 * waits, holding its places, until the organizer decides.
 *
 * While a registration waits, its places are counted in `ticket_types.sold`
 * — so the public count, the sold-out badge and the waitlist all tell the
 * truth, and nobody else can take them — and its tickets do not exist yet.
 */

export interface PlacementInput {
  /** The event's rule at the moment of placing. */
  requiresApproval: boolean;
  paymentRequired: boolean;
  /** An organizer entering the booking by hand (US-REG-03). */
  organizerEntry: boolean;
}

export interface Placement {
  /** Mint the tickets now — only a free order nobody has to decide on. */
  issueTickets: boolean;
  /** The rule this order follows from now on, whatever the event later says. */
  requiresApproval: boolean;
  /** Nothing is owed, so the decision is the only thing left from the start. */
  awaitsDecision: boolean;
}

/** How an order starts out, given the rule it was placed under. */
export function placementFor(input: PlacementInput): Placement {
  // An organizer booking someone in has already decided; asking them to
  // approve their own entry would be a form with one possible answer.
  const requiresApproval = input.requiresApproval && !input.organizerEntry;
  return {
    issueTickets: !input.paymentRequired && !requiresApproval,
    requiresApproval,
    awaitsDecision: requiresApproval && !input.paymentRequired,
  };
}

/** Waiting for the organizer — neither for money nor for anything else. */
export function isAwaitingApproval(order: {
  status: OrderStatus;
  approvalRequestedAt: Date | null;
}): boolean {
  return order.status === 'pending' && order.approvalRequestedAt !== null;
}

/**
 * Still waiting for the buyer's money, on the checkout's clock — the only time
 * a payment attempt lapsing may give the order's seats back.
 *
 * One order can have several attempts (a PromptPay QR opened, then a card
 * paid), and each lapses on its own. Once any of them has paid, or the order
 * waits for the organizer, a stale attempt's expiry says nothing about the
 * order: the seats are paid for, or held for a decision.
 */
export function isOnCheckoutClock(order: {
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  approvalRequestedAt: Date | null;
}): boolean {
  return (
    order.status === 'pending' &&
    order.paymentStatus !== 'paid' &&
    order.approvalRequestedAt === null
  );
}

/**
 * Where a refunded order ends up. A rejected registration stays rejected: the
 * refund is the consequence of the organizer's "no", and overwriting it with
 * `cancelled` would erase who decided what.
 */
export function statusAfterRefund(
  status: OrderStatus,
): 'rejected' | 'cancelled' {
  return status === 'rejected' ? 'rejected' : 'cancelled';
}

/**
 * The expiry a reserved seat's hold takes while its registration waits for a
 * decision. A decision, not a clock, ends this hold — and every availability
 * query already reads `expires_at`, so a date no clock reaches keeps the seat
 * off sale without teaching any of them a new rule.
 */
export const DECISION_HOLD_EXPIRY = new Date('9999-12-31T23:59:59Z');
