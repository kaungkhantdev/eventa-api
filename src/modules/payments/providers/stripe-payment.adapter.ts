import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { GatewayCredentialsPort } from '../ports/gateway-credentials.port';
import { DomainException } from '../../../common/errors/domain.exception';
import { STRIPE_API_VERSION } from '../../../common/stripe/stripe-api-version';
import { Clock } from '../../../common/time/clock';
import type { Env } from '../../../config/env.validation';
import {
  PaymentProviderPort,
  type PaymentMethodChoice,
  type StartPaymentInput,
  type RefundPaymentInput,
  type RefundedPayment,
  type RetriedPayout,
  type RetryPayoutInput,
  type StartedPayment,
  type VerifiedWebhook,
} from '../ports/payment-provider.port';

const MS_PER_SECOND = 1000;
const THB = 'thb';
/** Stripe's documented Thai limits: ฿10 minimum, 8 digits maximum. */
const MIN_THB_SATANG = 1_000;
const MAX_THB_SATANG = 99_999_999;

/**
 * A card statement descriptor is Latin-only and the whole line (prefix + `* ` +
 * suffix) must fit 22 characters, so the suffix gets what is left.
 */
const MAX_SUFFIX_LENGTH = 12;
const MIN_SUFFIX_LENGTH = 5;
const NON_LATIN = /[^A-Za-z0-9 ]/g;

/** Stripe's code for "the buyer never completed it in time" (PromptPay lapse). */
const ATTEMPT_EXPIRED = 'payment_intent_payment_attempt_expired';

/** How a Stripe client is made from a key. Injected so a test can supply its own. */
export type StripeClientFactory = (secretKey: string) => Stripe;

export const defaultStripeClient: StripeClientFactory = (secretKey) =>
  new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION, typescript: true });

/**
 * Signature checking is pure HMAC over the raw bytes — it never calls Stripe and
 * never uses an API key. One throwaway client exists only to reach that method;
 * the placeholder is never sent anywhere.
 */
const WEBHOOK_VERIFIER = new Stripe('sk_signature_check_only', {
  apiVersion: STRIPE_API_VERSION,
});

/**
 * Verification needs no key, only the endpoint's signing secret — so it is a
 * free function rather than a method, and a callback can be checked without
 * first working out whose it is.
 *
 * An unverified webhook is a stranger claiming an order was paid: the one input
 * that could hand out tickets for free. Stripe's own check runs over the RAW
 * bytes. Each candidate secret is tried because a workspace registers the same
 * URL in test and live and gets a different secret from each; if none matches,
 * the callback is refused.
 */
function constructEvent(
  rawBody: Buffer,
  signature: string,
  signingSecrets: readonly string[],
): Stripe.Event {
  for (const secret of signingSecrets) {
    try {
      return WEBHOOK_VERIFIER.webhooks.constructEvent(
        rawBody,
        signature,
        secret,
      );
    } catch {
      continue;
    }
  }
  throw DomainException.forbidden('Invalid webhook signature.');
}

const IGNORED: VerifiedWebhook = {
  eventId: '',
  type: 'ignored',
  gatewayRef: '',
  amountSatang: 0,
  declineReason: null,
};

/**
 * Stripe, behind `PaymentProviderPort` — the real-money implementation of the
 * PCI SAQ-A boundary. No card detail crosses this file: a card payment returns
 * a `client_secret` that authorises Stripe's OWN hosted fields, and PromptPay
 * returns a bank-scannable payload for an amount.
 *
 * Three Stripe specifics worth knowing, each verified against the installed SDK
 * and the published docs rather than assumed:
 *
 * - **PromptPay has no provider-side expiry.** Unlike PayNow or Pix, Stripe
 *   exposes no `expires_at` on the QR next-action and no knob to set one, so the
 *   deadline is ours (`PROMPTPAY_EXPIRY_SECONDS`). It is anchored to the
 *   intent's own `created`, not to `now`, so an idempotent replay returns the
 *   same deadline instead of quietly extending it.
 * - **Settlement reads `amount_received`, not `amount`** — the former is what
 *   landed, the latter what we asked for. The service compares it against the
 *   order and refuses to settle a short payment.
 * - **Cards take `statement_descriptor_suffix`, PromptPay takes nothing.**
 *   Stripe rejects a full descriptor on cards and documents that PromptPay
 *   ignores the value outright (buyers see Stripe's Thai entity instead).
 */
@Injectable()
export class StripePaymentAdapter extends PaymentProviderPort {
  private readonly promptPayTtlSeconds: number;

  constructor(
    private readonly clock: Clock,
    config: ConfigService<Env, true>,
    private readonly credentials: GatewayCredentialsPort,
    /** Injected so a test supplies its own client without a real key. */
    private readonly clientFor: StripeClientFactory = defaultStripeClient,
  ) {
    super();
    this.promptPayTtlSeconds = config.getOrThrow('PROMPTPAY_EXPIRY_SECONDS', {
      infer: true,
    });
  }

  /**
   * A client authenticated as this workspace.
   *
   * Built per call rather than once at boot, because there is no longer one key
   * — there is one per workspace, and the right one depends on whose order is
   * being charged. The plaintext is borrowed for the length of the call and
   * never held on the instance: this adapter is a singleton, so a cached key
   * would be the wrong workspace's the moment a second one paid.
   */
  private async as(organizationId: number): Promise<Stripe> {
    return this.clientFor(await this.credentials.secretKeyFor(organizationId));
  }

  /**
   * Open a hosted Checkout Session and hand back its URL (US-DISC-05).
   *
   * A Session rather than a bare PaymentIntent, because the payment page is
   * then Stripe's own: the browser needs no publishable key, no account id and
   * no SDK, which is what keeps a multi-tenant product simple — each workspace
   * charges on its own connected account, and none of that reaches the client.
   *
   * In `payment` mode the Session creates its PaymentIntent immediately, so
   * `payment_intent` is the reference stored as `gateway_ref`. That is
   * deliberate: settlement still arrives as `payment_intent.succeeded` and
   * refunds still take a `pi_…`, so neither had to change.
   */
  async start(input: StartPaymentInput): Promise<StartedPayment> {
    assertChargeable(input);
    // PromptPay stays a PaymentIntent: its QR renders in our own page, and
    // sending somebody to a hosted page to look at a code they scan on their
    // phone would be a worse journey, not a safer one. Only the card needs
    // fields we must never host.
    const stripe = await this.as(input.organizationId);
    if (input.method === 'PromptPay') {
      const intent = await stripe.paymentIntents.create(
        this.params(input),
        requestOptions(input),
      );
      return this.toStartedPayment(intent, input.method);
    }
    const session = await stripe.checkout.sessions.create(
      this.sessionParams(input),
      requestOptions(input),
    );
    return {
      gatewayRef: intentIdOf(session),
      // Nothing is owed-and-settled at this point: the buyer has not opened the
      // page yet, let alone paid. Only the webhook says otherwise.
      status: 'requires_action',
      checkoutUrl: session.url,
      clientSecret: null,
      promptPayQr: null,
      expiresAt: session.expires_at
        ? new Date(session.expires_at * 1000)
        : null,
      declineReason: null,
    };
  }

  private sessionParams(
    input: StartPaymentInput,
  ): Stripe.Checkout.SessionCreateParams {
    const metadata = {
      order_id: input.orderId,
      org_id: String(input.organizationId),
    };
    const suffix = statementDescriptorSuffix(input.statementDescriptor);
    return {
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: input.buyerEmail,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: input.amountSatang,
            product_data: { name: input.description },
          },
        },
      ],
      // Both land on the order page. Cancelling is not failing — the order is
      // still there, still unpaid, and still payable.
      success_url: input.returnUrl,
      cancel_url: input.returnUrl,
      metadata,
      payment_intent_data: {
        metadata,
        receipt_email: input.buyerEmail,
        // A SUFFIX, and Latin-only — the same rule the intent path follows,
        // because cards reject the full form and reject Thai script outright.
        ...(suffix ? { statement_descriptor_suffix: suffix } : {}),
      },
    };
  }

  /**
   * Full refund to the original method. `pending` is a real outcome rather than
   * a failure — a PromptPay refund waits on the buyer's bank details, which
   * Stripe collects by email, so the ledger records it and the webhook confirms.
   */
  async refund(input: RefundPaymentInput): Promise<RefundedPayment> {
    const stripe = await this.as(input.organizationId);
    const refund = await stripe.refunds.create(
      { payment_intent: input.gatewayRef, amount: input.amountSatang },
      { idempotencyKey: input.idempotencyKey },
    );
    return {
      refundRef: refund.id,
      status: toRefundStatus(refund.status),
      failureReason: refund.failure_reason ?? null,
    };
  }

  verifyWebhook(
    rawBody: Buffer,
    signature: string,
    signingSecrets: readonly string[],
  ): VerifiedWebhook {
    return toVerifiedWebhook(
      constructEvent(rawBody, signature, signingSecrets),
    );
  }

  /**
   * A single-use login link onto the connected account's Express dashboard,
   * where the organizer manages bank details, schedule and tax forms
   * (US-FIN-05). This is what keeps bank data out of Eventa entirely: Stripe
   * collects and shows it, we only hold the `acct_…` reference.
   */
  async payoutSettingsLink(
    organizationId: number,
    accountId: string | null,
  ): Promise<string | null> {
    if (!accountId) return null;
    const stripe = await this.as(organizationId);
    const link = await stripe.accounts.createLoginLink(accountId);
    return link.url;
  }

  /**
   * Stripe has no "retry" verb — a failed payout is recovered by creating a
   * fresh one for the same money. `idempotencyKey` is OUR payout reference, so
   * a double-tapped Retry produces one transfer, and the caller updates the
   * existing row rather than inserting a second payout.
   */
  async retryPayout(input: RetryPayoutInput): Promise<RetriedPayout> {
    try {
      const stripe = await this.as(input.organizationId);
      const payout = await stripe.payouts.create(
        {
          amount: input.amountSatang,
          currency: input.currency.toLowerCase(),
          metadata: { eventa_reference: input.reference },
        },
        { idempotencyKey: `payout-retry:${input.reference}` },
      );
      return {
        payoutRef: payout.id,
        status: payout.status === 'failed' ? 'failed' : 'processing',
        failureReason: payout.failure_message ?? null,
      };
    } catch (error) {
      // A rejected payout is an outcome the organizer must see, not a 500 —
      // insufficient balance and a closed bank account both land here.
      const reason =
        error instanceof Stripe.errors.StripeError ? error.message : null;
      return { payoutRef: '', status: 'failed', failureReason: reason };
    }
  }

  private params(input: StartPaymentInput): Stripe.PaymentIntentCreateParams {
    const common = {
      amount: input.amountSatang,
      currency: input.currency.toLowerCase(),
      metadata: {
        order_id: input.orderId,
        org_id: String(input.organizationId),
      },
    };
    return input.method === 'PromptPay'
      ? { ...common, ...promptPayParams(input) }
      : { ...common, ...cardParams(input) };
  }

  private toStartedPayment(
    intent: Stripe.PaymentIntent,
    method: PaymentMethodChoice,
  ): StartedPayment {
    const failure = intent.last_payment_error;
    const qr = intent.next_action?.promptpay_display_qr_code ?? null;
    return {
      gatewayRef: intent.id,
      status: toStartedStatus(intent),
      // This path answers a PaymentIntent, not a hosted Session; `start` is
      // the one that opens a page.
      checkoutUrl: null,
      clientSecret: method === 'Card' ? intent.client_secret : null,
      promptPayQr: qr?.data ?? null,
      expiresAt: qr ? this.qrDeadline(intent) : null,
      declineReason: failure?.message ?? null,
    };
  }

  /** Ours to decide — Stripe publishes no PromptPay expiry. See the class note. */
  private qrDeadline(intent: Stripe.PaymentIntent): Date {
    const createdMs = intent.created
      ? intent.created * MS_PER_SECOND
      : this.clock.now().getTime();
    return new Date(createdMs + this.promptPayTtlSeconds * MS_PER_SECOND);
  }
}

function cardParams(
  input: StartPaymentInput,
): Partial<Stripe.PaymentIntentCreateParams> {
  const suffix = statementDescriptorSuffix(input.statementDescriptor);
  return {
    payment_method_types: ['card'],
    receipt_email: input.buyerEmail,
    ...(suffix ? { statement_descriptor_suffix: suffix } : {}),
  };
}

/**
 * Created and confirmed in one call: PromptPay's whole purpose is to land in
 * `requires_action` carrying a QR. The billing email is not optional in
 * practice — Stripe needs it to collect bank details if a refund is ever due.
 */
function promptPayParams(
  input: StartPaymentInput,
): Partial<Stripe.PaymentIntentCreateParams> {
  return {
    payment_method_types: ['promptpay'],
    payment_method_data: {
      type: 'promptpay',
      billing_details: { email: input.buyerEmail },
    },
    confirm: true,
  };
}

/**
 * No `stripeAccount`: the client is already authenticated AS the workspace, so
 * acting on behalf of one would be asking their own key to impersonate them.
 */
function requestOptions(input: StartPaymentInput): Stripe.RequestOptions {
  return { idempotencyKey: input.idempotencyKey };
}

/** Fail before the money moves, with a reason a human can act on. */
function assertChargeable(input: StartPaymentInput): void {
  if (input.currency.toLowerCase() !== THB) {
    throw DomainException.validation(
      `Stripe payments settle in THB; this order is in ${input.currency}.`,
    );
  }
  if (input.amountSatang < MIN_THB_SATANG) {
    throw DomainException.validation(
      'A card or PromptPay payment must be at least ฿10.',
    );
  }
  if (input.amountSatang > MAX_THB_SATANG) {
    throw DomainException.validation(
      'This total is above the maximum a single payment can collect.',
    );
  }
}

/**
 * Cards reject a full `statement_descriptor` and accept only a Latin suffix, so
 * a Thai event name has no representation here — an omitted suffix (the buyer
 * sees the workspace's own Stripe prefix) beats a mangled one.
 */
function statementDescriptorSuffix(descriptor: string | null): string | null {
  if (!descriptor) return null;
  const latin = descriptor
    .replace(NON_LATIN, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SUFFIX_LENGTH)
    .trim();
  return latin.length >= MIN_SUFFIX_LENGTH ? latin : null;
}

/**
 * Anything Stripe reports that is not plainly succeeded or in flight counts as
 * failed. Guessing the other way would mark money as returned when it was not.
 */
function toRefundStatus(status: string | null): RefundedPayment['status'] {
  if (status === 'succeeded') return 'succeeded';
  if (status === 'pending') return 'pending';
  return 'failed';
}

function toStartedStatus(
  intent: Stripe.PaymentIntent,
): StartedPayment['status'] {
  if (intent.status === 'succeeded') return 'succeeded';
  if (intent.status === 'canceled' || intent.last_payment_error)
    return 'failed';
  return 'requires_action';
}

/**
 * The mapping table. Anything absent is `ignored` on purpose — it never reaches
 * `webhook_events`, so an unhandled Stripe event cannot move an order.
 */
function toVerifiedWebhook(event: Stripe.Event): VerifiedWebhook {
  switch (event.type) {
    // The settling event for a hosted checkout. `payment_intent.succeeded`
    // also fires, but carries a `pi_…` that matches nothing: the reference
    // stored at `start` is the session's, because the intent did not exist yet.
    case 'checkout.session.completed':
      return fromSession(event, sessionOf(event));
    case 'checkout.session.expired':
      return {
        eventId: event.id,
        type: 'expired',
        gatewayRef: sessionOf(event).id,
        amountSatang: 0,
        declineReason: null,
      };
    case 'payment_intent.succeeded':
      return settled(event, intentOf(event), 'succeeded');
    case 'payment_intent.payment_failed':
      return failure(event, intentOf(event));
    case 'payment_intent.canceled':
      return settled(event, intentOf(event), 'expired');
    default:
      return IGNORED;
  }
}

/**
 * The Session's PaymentIntent id — a string, an expanded object, or absent.
 *
 * Absent is the NORMAL case at creation: Checkout does not mint the intent
 * until the buyer pays. Falling back to the session id is what lets `start`
 * store a reference at all, and `checkout.session.completed` is what later
 * reconciles it onto the real `pi_…`.
 */
function intentIdOf(session: Stripe.Checkout.Session): string {
  const intent = session.payment_intent;
  if (typeof intent === 'string') return intent;
  return intent?.id ?? session.id;
}

function sessionOf(event: Stripe.Event): Stripe.Checkout.Session {
  return event.data.object as Stripe.Checkout.Session;
}

/**
 * A completed session, settled under the reference we actually stored.
 *
 * Only `paid` counts: a session can complete while the money is still in
 * flight — an async method, or a delayed capture — and that is not settled.
 */
function fromSession(
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
): VerifiedWebhook {
  if (session.payment_status !== 'paid') return IGNORED;
  return {
    eventId: event.id,
    type: 'succeeded',
    gatewayRef: session.id,
    // What a refund will need; the stored reference is reconciled onto it.
    settledRef: intentIdOf(session),
    amountSatang: session.amount_total ?? 0,
    declineReason: null,
  };
}

function intentOf(event: Stripe.Event): Stripe.PaymentIntent {
  return event.data.object as Stripe.PaymentIntent;
}

function settled(
  event: Stripe.Event,
  intent: Stripe.PaymentIntent,
  type: VerifiedWebhook['type'],
): VerifiedWebhook {
  return {
    eventId: event.id,
    type,
    gatewayRef: intent.id,
    // What landed, not what was asked for — a short payment must not settle.
    amountSatang: intent.amount_received ?? intent.amount,
    declineReason: null,
  };
}

/**
 * A lapsed PromptPay QR and a declined card arrive as the same event type and
 * differ only by error code — and they mean opposite things for inventory:
 * expired releases the seats, failed keeps them so the buyer can retry.
 */
function failure(
  event: Stripe.Event,
  intent: Stripe.PaymentIntent,
): VerifiedWebhook {
  const error = intent.last_payment_error;
  return {
    eventId: event.id,
    type: error?.code === ATTEMPT_EXPIRED ? 'expired' : 'failed',
    gatewayRef: intent.id,
    amountSatang: intent.amount_received ?? intent.amount,
    declineReason: error?.message ?? null,
  };
}
