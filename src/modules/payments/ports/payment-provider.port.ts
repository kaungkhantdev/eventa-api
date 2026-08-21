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
  /**
   * What the buyer is paying for, shown on the provider's own page.
   *
   * The event's name rather than an order reference: somebody deciding whether
   * to type a card number needs to recognise what they are buying, and
   * "ORD-27VEEC7Y" tells them nothing.
   */
  description: string;
  /** Exactly-once at the provider, not just here — a retry must not double-charge. */
  idempotencyKey: string;
  /**
   * Where the provider returns the buyer once its hosted page is done.
   *
   * Built by the caller from `PUBLIC_WEB_URL`, because the adapter has no
   * notion of the web origin — the same reason `verifyUrl` and `ticketsUrl`
   * are built there. Landing on it means the buyer finished at the provider,
   * NOT that the money moved; only the webhook settles.
   */
  returnUrl: string;
}

/**
 * The provider's answer. Nothing here is card data — and with a hosted
 * checkout, nothing here even touches a payment form: `checkoutUrl` is a page
 * on the provider's own domain. That is what keeps this app in PCI SAQ-A and
 * keeps the browser free of any provider key, which matters most for a
 * multi-tenant product where each workspace charges on its own account.
 */
export interface StartedPayment {
  /** The provider's reference (e.g. Stripe `pi_…`), stored as `gateway_ref`. */
  gatewayRef: string;
  status: 'requires_action' | 'succeeded' | 'failed';
  /**
   * The provider's own hosted payment page. The browser is sent here and comes
   * back to `returnUrl`; it never learns a key, an account id, or an SDK.
   */
  checkoutUrl: string | null;
  /** Card only — the key to the provider's hosted FIELDS, when embedded. */
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
  /** Whose key reverses it — the same workspace that took the money. */
  organizationId: number;
  /** The provider's reference for the original charge (`gateway_ref`). */
  gatewayRef: string;
  amountSatang: number;
  /** Exactly-once at the PROVIDER — a double-click must not refund twice. */
  idempotencyKey: string;
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

/** Re-submit a settlement the bank rejected (US-FIN-04). */
export interface RetryPayoutInput {
  /** Whose key re-submits it. */
  organizationId: number;
  /** OUR reference for the payout being recovered. */
  reference: string;
  amountSatang: number;
  currency: string;
}

export interface RetriedPayout {
  /** The provider's reference for the RE-submitted transfer. */
  payoutRef: string;
  status: 'processing' | 'failed';
  failureReason: string | null;
}

/** What a verified provider callback turned out to mean. */
export interface VerifiedWebhook {
  /** The PROVIDER's event id — what `webhook_events` dedupes on. */
  eventId: string;
  type: 'succeeded' | 'failed' | 'expired' | 'ignored';
  gatewayRef: string;
  /**
   * The reference the provider settled under, when it differs from the one we
   * stored.
   *
   * A hosted Checkout Session has no PaymentIntent when it is created, so the
   * reference kept at `start` is the SESSION id. The intent only exists once
   * the buyer has paid, and it is what a refund needs — so settlement carries
   * it out and the stored reference is reconciled onto it.
   */
  settledRef?: string | null;
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
  /**
   * `signingSecrets` rather than one, because a workspace registers the same
   * URL in the provider's test and live dashboards and each issues its own. The
   * event does not say which until it is verified.
   */
  abstract verifyWebhook(
    rawBody: Buffer,
    signature: string,
    signingSecrets: readonly string[],
  ): VerifiedWebhook;

  /**
   * Return a settled charge to its original method. Idempotent on the given
   * key — the story requires that a double-submitted refund issues exactly one.
   * Full refunds only in this release.
   */
  abstract refund(input: RefundPaymentInput): Promise<RefundedPayment>;

  /**
   * A one-time URL onto the provider's own hosted dashboard, where an Admin
   * manages bank details, the payout schedule and tax forms (US-FIN-05).
   *
   * The link is how bank details stay OUT of this service: Eventa never sees an
   * account number, only that a connected account exists. Returns null when the
   * workspace has no connected account yet — the caller must guide them through
   * connecting before there is anything to manage.
   */
  abstract payoutSettingsLink(
    organizationId: number,
    accountId: string | null,
  ): Promise<string | null>;

  /**
   * Re-submit a failed payout to the same connected account (US-FIN-04). The
   * provider issues a fresh transfer; the caller updates the EXISTING payout
   * row rather than inserting a second one, so the organizer never sees a
   * duplicate for money that only moved once.
   */
  abstract retryPayout(input: RetryPayoutInput): Promise<RetriedPayout>;
}
