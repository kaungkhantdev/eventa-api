import type { AuthContext } from '../../auth/auth.types';

/** What giving a rejected registration's money back came to. */
export interface RejectionRefund {
  /**
   * `succeeded` — the money is on its way back and the ledger says so.
   * `pending` — the provider accepted it but has not settled it yet (a
   * PromptPay refund waits for the buyer's bank details); its webhook
   * finishes it later, through the ordinary refund path.
   */
  status: 'succeeded' | 'pending';
  amountSatang: number;
}

/**
 * Refund a registration the organizer rejected after it was paid for while
 * waiting for approval (US-REG-02, US-FIN-02).
 *
 * Registrations owns this abstraction and Payments binds it, so the money goes
 * back through THE refund path — the ledger claim, the provider call and the
 * one transaction that flips the payment — rather than a second way to move
 * money. Exactly once per registration however often it is asked: the refund
 * is keyed by the order, so a retried rejection finds the refund it already
 * made instead of making another.
 */
export abstract class RegistrationRefundPort {
  abstract refundRejected(
    auth: AuthContext,
    orderId: string,
  ): Promise<RejectionRefund>;
}
