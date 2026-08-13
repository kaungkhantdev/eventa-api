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

export interface RejectionInput {
  decidedBy: string;
  reason: string | null;
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
   * Reject: release the held seat so it can go to someone else and queue the
   * notice. Terminal — the status re-check happens under the order's row lock,
   * so two organizers deciding at once cannot both win.
   */
  abstract reject(
    organizationId: number,
    orderId: string,
    input: RejectionInput,
  ): Promise<{ reference: string }>;
}
