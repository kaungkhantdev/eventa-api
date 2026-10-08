import type { orderStatusEnum, paymentStatusEnum } from '../../db/schema';

type OrderStatus = (typeof orderStatusEnum.enumValues)[number];
type PaymentStatus = (typeof paymentStatusEnum.enumValues)[number];

export const APPROVE_BLOCKED_UNPAID =
  "Payment isn't complete yet, so this registration can't be approved.";
export const REJECT_BLOCKED_PAID =
  'Money has been captured for this registration — cancel and refund it instead of rejecting.';
export const REJECT_NEEDS_REFUND_PERMISSION =
  'Rejecting this registration refunds its payment, and refunds need the refund permission — ask an Admin.';
const ALREADY_REJECTED =
  'This registration was rejected, and a rejection cannot be undone.';
const NOT_AWAITING =
  'Only a pending or waitlisted registration can be decided.';
export const OFFER_NOT_WAITLISTED =
  'Only someone on the waitlist can be offered a seat.';

/** The slice of a registration a decision turns on. */
export interface DecidableRegistration {
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  totalSatang: number;
  /**
   * When it started waiting for the organizer on an event that requires
   * approval (US-REG-02); null for anything else. Money taken while this is
   * set was taken on the promise of a decision, so a "no" gives it back.
   */
  approvalRequestedAt: Date | null;
}

/** What the person deciding may do beyond deciding. */
export interface DeciderAccess {
  /** Holds the refund permission (US-FIN-02) — refunds are Finance's call. */
  mayRefund: boolean;
}

export interface Verdict {
  allowed: boolean;
  /** Why not — shown to the organizer, so it must say what to do instead. */
  reason: string | null;
}

/** Pending and waitlisted are the two states awaiting an organizer. */
const AWAITING: readonly OrderStatus[] = ['pending', 'waitlisted'];

/**
 * Whether an organizer may approve (US-REG-02). A free registration can be
 * approved outright; a paid one may not be approved until the money is
 * actually in, or the organizer would be issuing a ticket against a charge
 * that might still fail.
 */
export function canApprove(registration: DecidableRegistration): Verdict {
  const terminal = terminalReason(registration.status);
  if (terminal) return refuse(terminal);
  if (registration.totalSatang > 0 && registration.paymentStatus !== 'paid') {
    return refuse(APPROVE_BLOCKED_UNPAID);
  }
  return { allowed: true, reason: null };
}

/**
 * Whether an organizer may reject (US-REG-02). Rejecting frees the seat.
 *
 * Money captured on an ordinary sale is refused here — that path is
 * cancel-and-refund, which puts the reversal through the refund ledger where
 * it can be reconciled. Money taken while the registration waited for
 * approval is different: the buyer paid on the promise of a decision, so
 * rejecting refunds it, through that same ledger. A refund is Finance's
 * privilege, so that rejection needs the refund permission too.
 */
export function canReject(
  registration: DecidableRegistration,
  access: DeciderAccess,
): Verdict {
  const terminal = terminalReason(registration.status);
  if (terminal) return refuse(terminal);
  if (rejectionRefunds(registration)) {
    return access.mayRefund
      ? { allowed: true, reason: null }
      : refuse(REJECT_NEEDS_REFUND_PERMISSION);
  }
  if (registration.paymentStatus === 'paid') return refuse(REJECT_BLOCKED_PAID);
  return { allowed: true, reason: null };
}

/**
 * Rejecting this registration gives money back: it was paid for while waiting
 * for approval, and the payment is still held. True of a rejection whose
 * refund has not gone through yet, too — a retried reject finishes it.
 */
export function rejectionRefunds(registration: DecidableRegistration): boolean {
  return (
    registration.paymentStatus === 'paid' &&
    registration.approvalRequestedAt !== null
  );
}

/**
 * Whether an organizer may offer this registration a seat (US-REG-04). Only a
 * waitlist entry: anybody else either has a seat already or is finished, and
 * an offer would hold a second seat for them. Paid or free alike — what the
 * offer then does differs (a free one confirms at once), whether it may be
 * made does not.
 */
export function canOffer(registration: DecidableRegistration): Verdict {
  if (registration.status === 'rejected') return refuse(ALREADY_REJECTED);
  if (registration.status !== 'waitlisted') return refuse(OFFER_NOT_WAITLISTED);
  return { allowed: true, reason: null };
}

function terminalReason(status: OrderStatus): string | null {
  if (status === 'rejected') return ALREADY_REJECTED;
  if (!AWAITING.includes(status)) return NOT_AWAITING;
  return null;
}

function refuse(reason: string): Verdict {
  return { allowed: false, reason };
}
