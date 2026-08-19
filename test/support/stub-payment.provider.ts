import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException } from '../../src/common/errors/domain.exception';
import { Clock } from '../../src/common/time/clock';
import type { Env } from '../../src/config/env.validation';
import {
  PaymentProviderPort,
  type StartPaymentInput,
  type RefundPaymentInput,
  type RefundedPayment,
  type RetriedPayout,
  type RetryPayoutInput,
  type StartedPayment,
  type VerifiedWebhook,
} from '../../src/modules/payments/ports/payment-provider.port';

const MS_PER_SECOND = 1000;
const SIGNATURE_ALGORITHM = 'sha256';
/** Used when no webhook secret is configured — `fake` needs no real credentials. */
const DEFAULT_TEST_SECRET = 'whsec_fake';

/**
 * A buyer whose email starts with this is declined, the way Stripe's test cards
 * work. It gives the suite (and a local developer) a way to walk the decline
 * path without a provider account.
 */
const DECLINE_PREFIX = 'decline';
const DECLINE_REASON = 'Your card was declined. Please try another card.';

/**
 * A TEST-ONLY stand-in for the payment provider.
 *
 * It lives here rather than in `src/` on purpose: a double that can mint a
 * "paid" order has no business in the shipped app, and keeping it beside the
 * suite means production has exactly one provider — the real one. Suites opt
 * in with `.overrideProvider(PaymentProviderPort).useClass(StubPaymentProvider)`.
 *
 * The original in-process payment provider used by tests and local development
 * (`PAYMENT_PROVIDER=fake`, the default so nothing charges a card by accident).
 *
 * It is a genuine double, not a stub: references are stable for an idempotency
 * key so a retry cannot double-charge, and `verifyWebhook` performs a real
 * timing-safe HMAC check. That last part matters — signature verification is the
 * one thing standing between a stranger and free tickets, so the suite exercises
 * the real comparison rather than a method that always returns true.
 */
@Injectable()
export class StubPaymentProvider extends PaymentProviderPort {
  private readonly secret: string;
  private readonly promptPayTtlSeconds: number;

  constructor(
    private readonly clock: Clock,
    config: ConfigService<Env, true>,
  ) {
    super();
    this.secret =
      config.get('STRIPE_WEBHOOK_SECRET', { infer: true }) ??
      DEFAULT_TEST_SECRET;
    this.promptPayTtlSeconds = config.getOrThrow('PROMPTPAY_EXPIRY_SECONDS', {
      infer: true,
    });
  }

  start(input: StartPaymentInput): Promise<StartedPayment> {
    const gatewayRef = `fake_pi_${digest(input.idempotencyKey).slice(0, 24)}`;
    if (input.buyerEmail.toLowerCase().startsWith(DECLINE_PREFIX)) {
      return Promise.resolve(declined(gatewayRef));
    }
    return Promise.resolve(
      input.method === 'PromptPay'
        ? this.promptPay(gatewayRef, input)
        : card(gatewayRef, input.returnUrl),
    );
  }

  /** Stable per key, so a double-submitted refund yields one reference. */
  refund(input: RefundPaymentInput): Promise<RefundedPayment> {
    return Promise.resolve({
      refundRef: `fake_re_${digest(input.idempotencyKey).slice(0, 24)}`,
      status: 'succeeded',
      failureReason: null,
    });
  }

  verifyWebhook(rawBody: Buffer, signature: string): VerifiedWebhook {
    this.assertSignature(rawBody, signature);
    return parseEvent(rawBody);
  }

  /** A stand-in dashboard URL; null mirrors "no account connected yet". */
  payoutSettingsLink(accountId: string | null): Promise<string | null> {
    if (!accountId) return Promise.resolve(null);
    return Promise.resolve(
      `https://fake-provider.test/express/${accountId}/payouts`,
    );
  }

  /** Stable per reference, so a double-tapped retry yields one transfer. */
  retryPayout(input: RetryPayoutInput): Promise<RetriedPayout> {
    return Promise.resolve({
      payoutRef: `fake_po_${digest(input.reference).slice(0, 24)}`,
      status: 'processing',
      failureReason: null,
    });
  }

  /**
   * Timing-safe, and length-checked first because `timingSafeEqual` throws on a
   * length mismatch rather than returning false.
   */
  private assertSignature(rawBody: Buffer, signature: string): void {
    const expected = createHmac(SIGNATURE_ALGORITHM, this.secret)
      .update(rawBody)
      .digest('hex');
    const given = Buffer.from(signature ?? '', 'utf8');
    const want = Buffer.from(expected, 'utf8');
    if (given.length !== want.length || !timingSafeEqual(given, want)) {
      throw DomainException.forbidden('Invalid webhook signature.');
    }
  }

  private promptPay(
    gatewayRef: string,
    input: StartPaymentInput,
  ): StartedPayment {
    return {
      gatewayRef,
      status: 'requires_action',
      // PromptPay is a QR scanned in a banking app — no page to send anyone to.
      checkoutUrl: null,
      clientSecret: null,
      // Shaped like an EMVCo payload so a client renders it the same as the real one.
      promptPayQr: `00020101021229370016A00000067701011101130066${input.amountSatang}`,
      expiresAt: new Date(
        this.clock.now().getTime() + this.promptPayTtlSeconds * MS_PER_SECOND,
      ),
      declineReason: null,
    };
  }
}

/**
 * A stand-in for the provider's hosted page.
 *
 * It points straight back at where the real one would return the buyer, so the
 * whole redirect round trip is exercised in dev and in the suite without a
 * Stripe account. It settles nothing — the webhook still has to arrive, exactly
 * as in production.
 */
function card(gatewayRef: string, returnUrl: string): StartedPayment {
  return {
    gatewayRef,
    status: 'requires_action',
    checkoutUrl: returnUrl,
    // Authorises the provider's hosted fields; it is not, and cannot be, a card.
    clientSecret: `${gatewayRef}_secret`,
    promptPayQr: null,
    expiresAt: null,
    declineReason: null,
  };
}

function declined(gatewayRef: string): StartedPayment {
  return {
    gatewayRef,
    status: 'failed',
    checkoutUrl: null,
    clientSecret: null,
    promptPayQr: null,
    expiresAt: null,
    declineReason: DECLINE_REASON,
  };
}

/** The stub's callback body — the same shape the Stripe adapter normalises to. */
function parseEvent(rawBody: Buffer): VerifiedWebhook {
  const body = JSON.parse(rawBody.toString('utf8')) as Partial<VerifiedWebhook>;
  return {
    eventId: body.eventId ?? '',
    type: body.type ?? 'ignored',
    gatewayRef: body.gatewayRef ?? '',
    amountSatang: body.amountSatang ?? 0,
    declineReason: body.declineReason ?? null,
  };
}

function digest(value: string): string {
  return createHmac(SIGNATURE_ALGORITHM, 'eventa-fake')
    .update(value)
    .digest('hex');
}
