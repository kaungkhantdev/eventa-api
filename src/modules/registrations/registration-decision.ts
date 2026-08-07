import type { orderStatusEnum, paymentStatusEnum } from '../../db/schema';

type OrderStatus = (typeof orderStatusEnum.enumValues)[number];
type PaymentStatus = (typeof paymentStatusEnum.enumValues)[number];

export const APPROVE_BLOCKED_UNPAID =
  "Payment isn't complete yet, so this registration can't be approved.";
export const REJECT_BLOCKED_PAID =
  'Money has been captured for this registration — cancel and refund it instead of rejecting.';
const ALREADY_REJECTED =
  'This registration was rejected, and a rejection cannot be undone.';
const NOT_AWAITING =
  'Only a pending or waitlisted registration can be decided.';

/** The slice of a registration a decision turns on. */
export interface DecidableRegistration {
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  totalSatang: number;
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
 * Whether an organizer may reject (US-REG-02). Rejecting frees the seat but
 * moves no money, so it is refused once anything has been captured — that path
 * is cancel-and-refund, which puts the reversal through the refund ledger
 * where it can be reconciled.
 */
export function canReject(registration: DecidableRegistration): Verdict {
  const terminal = terminalReason(registration.status);
  if (terminal) return refuse(terminal);
  if (registration.paymentStatus === 'paid') return refuse(REJECT_BLOCKED_PAID);
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
