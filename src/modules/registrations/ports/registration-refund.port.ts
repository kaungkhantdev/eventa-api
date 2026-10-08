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
 * money. Every payment the registration took goes back — a duplicate that
 * landed while it waited too — each exactly once however often it is asked:
 * each refund is keyed by the order and the payment, so a retried rejection
 * finds the refunds it already made and makes only the missing ones.
 */
export abstract class RegistrationRefundPort {
  abstract refundRejected(
    auth: AuthContext,
    orderId: string,
  ): Promise<RejectionRefund>;
}
