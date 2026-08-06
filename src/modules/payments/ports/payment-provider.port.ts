import { paymentMethodEnum } from '../../../db/schema';

/** The methods an attendee may choose at checkout (US-DISC-05). */
export type PaymentMethodChoice = Extract<
  (typeof paymentMethodEnum.enumValues)[number],
  'Card' | 'PromptPay'
>;

/** What the provider is asked to collect. Note what is absent: any card detail. */
export interface StartPaymentInput {
  orderId: string;
  organizationId: number;
  amountSatang: number;
  currency: string;
  method: PaymentMethodChoice;
  buyerEmail: string;
  /** ≤22 chars, shown on the buyer's statement (US-SET-10). */
  statementDescriptor: string | null;
  /** The workspace's connected account at the provider; null = platform account. */
  accountId: string | null;
  /** Exactly-once at the provider, not just here — a retry must not double-charge. */
  idempotencyKey: string;
}

/**
 * The provider's answer. `clientSecret` and `promptPayQr` are the only things
 * that reach the browser, and neither is card data: one authorises the provider's
 * OWN hosted fields, the other is a bank-scannable payload for an amount.
 */
export interface StartedPayment {
  /** The provider's reference (e.g. Stripe `pi_…`), stored as `gateway_ref`. */
  gatewayRef: string;
  status: 'requires_action' | 'succeeded' | 'failed';
  /** Card only — hands off to the provider's hosted fields. */
  clientSecret: string | null;
  /** PromptPay only — the payload a Thai banking app scans. */
  promptPayQr: string | null;
  /** When a PromptPay code lapses; null for card. */
  expiresAt: Date | null;
  /** A plain reason when the attempt was declined outright. */
  declineReason: string | null;
}

/** Give money back to the card or wallet it came from (US-FIN-02). */
export interface RefundPaymentInput {
  /** The provider's reference for the original charge (`gateway_ref`). */
  gatewayRef: string;
  amountSatang: number;
  /** Exactly-once at the PROVIDER — a double-click must not refund twice. */
  idempotencyKey: string;
  /** The workspace's connected account; null = platform account. */
  accountId: string | null;
}

/**
 * The provider's answer. `pending` is a real outcome, not a failure: a
 * PromptPay refund needs the buyer's bank details and settles later, so the
 * ledger records it and the webhook confirms it.
 */
export interface RefundedPayment {
  refundRef: string;
  status: 'succeeded' | 'pending' | 'failed';
  failureReason: string | null;
}

/** What a verified provider callback turned out to mean. */
export interface VerifiedWebhook {
  /** The PROVIDER's event id — what `webhook_events` dedupes on. */
  eventId: string;
  type: 'succeeded' | 'failed' | 'expired' | 'ignored';
  gatewayRef: string;
  amountSatang: number;
  declineReason: string | null;
}

/**
 * The payment provider, behind an abstraction (DIP) — and the PCI SAQ-A boundary
 * of this service.
 *
 * **No card, bank or wallet detail ever crosses this interface**, in either
 * direction. The attendee types their card into the provider's own hosted
 * fields; Eventa handles references, amounts and statuses. There is deliberately
 * no method here that could accept a PAN, and adding one would take this service
 * out of SAQ-A scope.
 *
 * Two implementations: `StripePaymentAdapter` for real money, and
 * `FakePaymentAdapter` for tests and local development. The provider is chosen by
 * `PAYMENT_PROVIDER`, which defaults to `fake` so nothing charges a card by
 * accident.
 */
export abstract class PaymentProviderPort {
  /** Ask the provider to collect `amountSatang`. Idempotent on the given key. */
  abstract start(input: StartPaymentInput): Promise<StartedPayment>;

  /**
   * Verify a callback's signature and say what it means.
   *
   * Takes the RAW body, because a signature covers the exact bytes sent — a
   * parsed-and-restringified object will not verify. Throws when the signature
   * does not check out: an unverified webhook is an attacker claiming an order
   * was paid, and is the one input that could hand out tickets for free.
   */
  abstract verifyWebhook(rawBody: Buffer, signature: string): VerifiedWebhook;

  /**
   * Return a settled charge to its original method. Idempotent on the given
   * key — the story requires that a double-submitted refund issues exactly one.
   * Full refunds only in this release.
   */
  abstract refund(input: RefundPaymentInput): Promise<RefundedPayment>;
}
