import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { DomainException } from '../../../common/errors/domain.exception';
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

/** Pinned by the installed SDK — `Stripe.LatestApiVersion` accepts nothing else. */
export const STRIPE_API_VERSION = '2026-07-29.dahlia';

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
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;
  private readonly promptPayTtlSeconds: number;

  constructor(
    private readonly clock: Clock,
    config: ConfigService<Env, true>,
    client?: Stripe,
  ) {
    super();
    this.webhookSecret = config.getOrThrow('STRIPE_WEBHOOK_SECRET', {
      infer: true,
    });
    this.promptPayTtlSeconds = config.getOrThrow('PROMPTPAY_EXPIRY_SECONDS', {
      infer: true,
    });
    this.stripe =
      client ??
      new Stripe(config.getOrThrow('STRIPE_SECRET_KEY', { infer: true }), {
        apiVersion: STRIPE_API_VERSION,
        typescript: true,
      });
  }

  async start(input: StartPaymentInput): Promise<StartedPayment> {
    assertChargeable(input);
    const intent = await this.stripe.paymentIntents.create(
      this.params(input),
      requestOptions(input),
    );
    return this.toStartedPayment(intent, input.method);
  }

  /**
   * Full refund to the original method. `pending` is a real outcome rather than
   * a failure — a PromptPay refund waits on the buyer's bank details, which
   * Stripe collects by email, so the ledger records it and the webhook confirms.
   */
  async refund(input: RefundPaymentInput): Promise<RefundedPayment> {
    const refund = await this.stripe.refunds.create(
      { payment_intent: input.gatewayRef, amount: input.amountSatang },
      {
        idempotencyKey: input.idempotencyKey,
        ...(input.accountId ? { stripeAccount: input.accountId } : {}),
      },
    );
    return {
      refundRef: refund.id,
      status: toRefundStatus(refund.status),
      failureReason: refund.failure_reason ?? null,
    };
  }

  verifyWebhook(rawBody: Buffer, signature: string): VerifiedWebhook {
    const event = this.constructEvent(rawBody, signature);
    return toVerifiedWebhook(event);
  }

  /**
   * A single-use login link onto the connected account's Express dashboard,
   * where the organizer manages bank details, schedule and tax forms
   * (US-FIN-05). This is what keeps bank data out of Eventa entirely: Stripe
   * collects and shows it, we only hold the `acct_…` reference.
   */
  async payoutSettingsLink(accountId: string | null): Promise<string | null> {
    if (!accountId) return null;
    const link = await this.stripe.accounts.createLoginLink(accountId);
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
      const payout = await this.stripe.payouts.create(
        {
          amount: input.amountSatang,
          currency: input.currency.toLowerCase(),
          metadata: { eventa_reference: input.reference },
        },
        {
          idempotencyKey: `payout-retry:${input.reference}`,
          ...(input.accountId ? { stripeAccount: input.accountId } : {}),
        },
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

  /**
   * An unverified webhook is a stranger claiming an order was paid — the one
   * input that could hand out tickets for free. Stripe's own verification runs
   * over the RAW bytes; anything it rejects becomes a 403.
   */
  private constructEvent(rawBody: Buffer, signature: string): Stripe.Event {
    try {
      return this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.webhookSecret,
      );
    } catch {
      throw DomainException.forbidden('Invalid webhook signature.');
    }
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

function requestOptions(input: StartPaymentInput): Stripe.RequestOptions {
  return {
    idempotencyKey: input.idempotencyKey,
    ...(input.accountId ? { stripeAccount: input.accountId } : {}),
  };
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
