import type { Tx } from '../../../db/tenant';

/** The slice of an order the payment flow may see. Money is integer satang. */
export interface PayableOrder {
  id: string;
  organizationId: number;
  reference: string;
  eventId: string;
  buyerName: string;
  buyerEmail: string;
  status: string;
  paymentStatus: string;
  totalSatang: number;
  currency: string;
}

/** What settling an order turned out to mean. */
export interface SettlementResult {
  /**
   * `settled` — tickets issued now. `already_settled` — a previous callback got
   * here first; nothing changed (exactly-once). `refund_required` — the money
   * arrived but the inventory could not be honoured (seats gone, tier sold out
   * while the buyer paid); the order is cancelled and a refund event queued.
   */
  outcome: 'settled' | 'already_settled' | 'refund_required';
  reference: string;
  ticketCount: number;
}

/**
 * Payments' view of the order it is collecting money for. Payments owns the
 * abstraction (DIP); the Checkout module — which owns orders, tickets and the
 * settlement transaction — binds the adapter. Payments never reads the orders
 * or tickets tables itself.
 */
export abstract class OrderPaymentPort {
  /**
   * The order a payment may be started against. Deliberately a GLOBAL lookup:
   * an anonymous buyer has no tenant, and the order's own row (reached by an
   * unguessable uuid) is what establishes one — never the caller.
   */
  abstract findPayable(orderId: string): Promise<PayableOrder | null>;

  /**
   * The money arrived — complete the registration. Issues the tickets, converts
   * the holds, bumps `sold` and queues the confirmation, all in ONE transaction;
   * `recordPayment` runs inside that same transaction so the payment row flips
   * to paid in the same commit as the tickets it paid for. Idempotent: an
   * already-confirmed order reports `already_settled` and changes nothing.
   */
  abstract settle(
    organizationId: number,
    orderId: string,
    recordPayment: (tx: Tx) => Promise<void>,
  ): Promise<SettlementResult>;

  /**
   * The payment lapsed or failed for good (e.g. a PromptPay code expired) —
   * give the held inventory back so someone else can buy it (US-DISC-05).
   */
  abstract releaseHolds(organizationId: number, orderId: string): Promise<void>;

  /**
   * Money arrived for an order that is already paid for — a second live payment
   * settled after the first (a buyer who started PromptPay, then paid by card,
   * and whose bank app scanned the old QR anyway). The registration stands; the
   * duplicate must go back, so a refund event is queued for the finance flow.
   */
  /**
   * The money went back — void the order's tickets and return their seats to
   * availability (US-FIN-02). `recordRefund` runs INSIDE that transaction, so
   * the refunded ledger and the freed seat commit together: a seat released
   * without the refund recorded would be sold twice on the strength of a
   * payment we still think is good.
   */
  abstract refundOrder(
    organizationId: number,
    orderId: string,
    recordRefund: (tx: Tx) => Promise<void>,
  ): Promise<{ ticketsVoided: number; seatsReleased: number }>;

  abstract queueRefund(
    organizationId: number,
    orderId: string,
    input: { amountSatang: number; reason: string },
  ): Promise<void>;
}
