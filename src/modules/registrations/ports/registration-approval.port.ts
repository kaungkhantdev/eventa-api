import type { DecidableRegistration } from '../registration-decision';

/** A registration the organizer may decide, as the queue needs to see it. */
export interface DecidableOrder extends DecidableRegistration {
  id: string;
  reference: string;
}

/**
 * What approving turned out to mean.
 *
 * `approved` — tickets issued now. `already_approved` — a retry arrived after
 * the first one won; nothing changed and no second confirmation was sent
 * (US-REG-02: "only one ticket is issued and only one confirmation is sent").
 * `unavailable` — the inventory went while the organizer was looking at the
 * list; the registration is left EXACTLY as it was, still awaiting a decision,
 * and `reason` says what to tell the attendee.
 */
export interface ApprovalResult {
  outcome: 'approved' | 'already_approved' | 'unavailable';
  reference: string;
  ticketCount: number;
  reason: string | null;
}

/**
 * What offering a waitlisted registration a seat turned out to mean
 * (US-REG-04).
 *
 * `offered` — a seat is held for them until `offerExpiresAt` and the offer is
 * queued. `already_offered` — a retry found that done; nothing was held twice
 * and nothing was sent twice. `no_seat` — nothing is free on their ticket;
 * the registration is left exactly as it was, still in line.
 */
export interface OfferResult {
  outcome: 'offered' | 'already_offered' | 'no_seat';
  reference: string;
  /** When an unpaid offer lapses and passes on; null when nothing was held. */
  offerExpiresAt: Date | null;
}

export interface RejectionInput {
  decidedBy: string;
  reason: string | null;
  /**
   * The decider holds the refund permission. Re-checked under the order's row
   * lock: a payment can land between the organizer reading the list and
   * clicking Reject, turning a plain rejection into one that refunds.
   */
  mayRefund: boolean;
}

/**
 * What rejecting did. `refundDue` — the registration was paid for while it
 * waited for approval and the money has not gone back yet: the caller refunds
 * it now. Also true when a rejection is retried after its refund failed, so
 * the retry can finish it.
 */
export interface RejectionResult {
  reference: string;
  refundDue: boolean;
}

/**
 * The organizer's decision on a sign-up (US-REG-02), expressed against the
 * module that owns orders, tickets and seat holds.
 *
 * Registrations owns this abstraction (DIP) and Checkout binds the adapter, so
 * approving runs THE settlement transaction — the same one a card payment
 * runs — rather than a second, subtly different way to mint a QR. One code
 * path issues tickets; this is a different door into it, not a copy of it.
 */
export abstract class RegistrationApprovalPort {
  /** The order under review, or null when it isn't this workspace's. */
  abstract findDecidable(
    organizationId: number,
    orderId: string,
  ): Promise<DecidableOrder | null>;

  /**
   * Approve: issue the tickets, seat the attendee, convert the holds and queue
   * the confirmation, all in one transaction. Idempotent — a repeat reports
   * `already_approved` and issues nothing further.
   */
  abstract approve(
    organizationId: number,
    orderId: string,
    decidedBy: string,
  ): Promise<ApprovalResult>;

  /**
   * Reject: give the places back so they can go to someone else and queue the
   * notice. Terminal — the status re-check happens under the order's row lock,
   * so two organizers deciding at once cannot both win. Moves no money itself:
   * `refundDue` tells the caller when there is money to give back.
   */
  abstract reject(
    organizationId: number,
    orderId: string,
    input: RejectionInput,
  ): Promise<RejectionResult>;

  /**
   * Offer a waitlisted registration a seat to pay for (US-REG-04): hold it for
   * the offer window, turn the registration `pending` so paying for it is the
   * ordinary checkout payment, record who offered it and how many were ahead,
   * and queue the offer email. The status re-check happens under the order's
   * row lock. Paid registrations only — a free one is simply approved.
   */
  abstract offer(
    organizationId: number,
    orderId: string,
    offeredBy: string,
  ): Promise<OfferResult>;
}
