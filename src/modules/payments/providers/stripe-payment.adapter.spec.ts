import type { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { DomainException } from '../../../common/errors/domain.exception';
import type { Clock } from '../../../common/time/clock';
import type { Env } from '../../../config/env.validation';
import type { StartPaymentInput } from '../ports/payment-provider.port';
import {
  STRIPE_API_VERSION,
  StripePaymentAdapter,
} from './stripe-payment.adapter';

const NOW = new Date('2026-06-01T00:00:00Z');
const SECRET_KEY = 'sk_test_dummy';
const WEBHOOK_SECRET = 'whsec_test_secret';
const TTL = 900;
const BAHT = 100;
/** Unix seconds; the adapter derives the QR deadline from this, not from now. */
const PI_CREATED = 1_800_000_000;
/** Unix seconds a Checkout Session lapses at. */
const SESSION_EXPIRES = 1_800_003_600;

const clock: Clock = { now: () => NOW };

function config(): ConfigService<Env, true> {
  return {
    get: (key: string) =>
      key === 'STRIPE_SECRET_KEY' ? SECRET_KEY : WEBHOOK_SECRET,
    getOrThrow: (key: string) =>
      key === 'PROMPTPAY_EXPIRY_SECONDS' ? TTL : WEBHOOK_SECRET,
  } as unknown as ConfigService<Env, true>;
}

/** Real Stripe object — its `webhooks` does genuine HMAC signing/verification. */
const real = new Stripe(SECRET_KEY, { apiVersion: STRIPE_API_VERSION });

interface Harness {
  adapter: StripePaymentAdapter;
  /** `paymentIntents.create` — the PromptPay path. */
  create: jest.Mock;
  /** `checkout.sessions.create` — the card path. */
  session: jest.Mock;
}

function harness(
  intent: Partial<Stripe.PaymentIntent> = {},
  checkout: Partial<Stripe.Checkout.Session> = {},
): Harness {
  const create = jest.fn().mockResolvedValue({
    id: 'pi_123',
    status: 'requires_action',
    client_secret: 'pi_123_secret_abc',
    created: PI_CREATED,
    next_action: null,
    last_payment_error: null,
    ...intent,
  });
  const session = jest.fn().mockResolvedValue({
    id: 'cs_test_123',
    url: 'https://checkout.stripe.com/c/pay/cs_test_123',
    payment_intent: 'pi_123',
    expires_at: SESSION_EXPIRES,
    ...checkout,
  });
  const client = {
    paymentIntents: { create },
    checkout: { sessions: { create: session } },
    webhooks: real.webhooks,
  } as unknown as Stripe;
  return {
    adapter: new StripePaymentAdapter(clock, config(), client),
    create,
    session,
  };
}

function input(o: Partial<StartPaymentInput> = {}): StartPaymentInput {
  return {
    orderId: 'o-1',
    organizationId: 7,
    description: 'Bangkok Tech Week',
    returnUrl: 'https://eventa.test/my/tickets/orders/o-1',
    amountSatang: 2_100 * BAHT,
    currency: 'THB',
    method: 'Card',
    buyerEmail: 'anan@example.test',
    statementDescriptor: 'Bangkok Tech Week',
    accountId: null,
    idempotencyKey: 'idem-1',
    ...o,
  };
}

/** Sign a body the way Stripe does, so verification is genuinely exercised. */
function signed(event: Record<string, unknown>): {
  raw: Buffer;
  signature: string;
} {
  const payload = JSON.stringify(event);
  return {
    raw: Buffer.from(payload, 'utf8'),
    signature: real.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    }),
  };
}

function paymentIntentEvent(
  type: string,
  intent: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id: 'evt_1',
    object: 'event',
    type,
    data: { object: { id: 'pi_123', object: 'payment_intent', ...intent } },
  };
}

function checkoutSessionEvent(
  session: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'evt_cs_1',
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_123',
        object: 'checkout.session',
        payment_status: 'paid',
        amount_total: 210_000,
        payment_intent: 'pi_123',
        ...session,
      },
    },
  };
}

describe('StripePaymentAdapter (US-DISC-05)', () => {
  /**
   * Card runs through a HOSTED Checkout Session, not a bare intent: the page
   * is Stripe's own, so no key, account id or SDK ever reaches the browser —
   * which is what keeps a multi-tenant product in PCI SAQ-A without the client
   * knowing which workspace it is paying.
   */
  describe('start — card', () => {
    const sessionParams = (session: jest.Mock) =>
      (session.mock.calls[0] as [Stripe.Checkout.SessionCreateParams])[0];

    it('hands back the hosted page, and never a card field of our own', async () => {
      const { adapter, create } = harness();
      const result = await adapter.start(input());

      expect(result.checkoutUrl).toBe(
        'https://checkout.stripe.com/c/pay/cs_test_123',
      );
      expect(result.clientSecret).toBeNull();
      expect(result.promptPayQr).toBeNull();
      // Nothing is owed-and-settled yet — the buyer has not opened the page.
      expect(result.status).toBe('requires_action');
      // The card path must not create a bare intent of its own.
      expect(create).not.toHaveBeenCalled();
    });

    /**
     * The Session's own PaymentIntent, not the Session id. Settlement arrives
     * as `payment_intent.succeeded` and refunds take a `pi_…`, so storing the
     * intent is what let both stay exactly as they were.
     */
    it('stores the PaymentIntent as the gateway reference', async () => {
      const { adapter } = harness();
      expect((await adapter.start(input())).gatewayRef).toBe('pi_123');
    });

    it('falls back to the session id when the intent is not expanded', async () => {
      const { adapter } = harness({}, { payment_intent: null });
      expect((await adapter.start(input())).gatewayRef).toBe('cs_test_123');
    });

    it('asks for the order total in satang, in lowercase thb', async () => {
      const { adapter, session } = harness();
      await adapter.start(input());

      const params = sessionParams(session);
      const [line] = params.line_items ?? [];
      expect(line?.price_data?.currency).toBe('thb');
      expect(line?.price_data?.unit_amount).toBe(210_000);
      expect(line?.quantity).toBe(1);
      expect(params.mode).toBe('payment');
      expect(params.payment_method_types).toEqual(['card']);
    });

    // Somebody deciding whether to type a card number needs to recognise what
    // they are buying; an order reference tells them nothing.
    it('names the event on the page, so the buyer knows what this is', async () => {
      const { adapter, session } = harness();
      await adapter.start(input({ description: 'Founders Coffee Connect' }));
      const [line] = sessionParams(session).line_items ?? [];
      expect(line?.price_data?.product_data?.name).toBe(
        'Founders Coffee Connect',
      );
    });

    // Cancelling is not failing: the order still exists, still unpaid, still
    // payable — so both endings land on the buyer's own copy of it.
    it('returns the buyer to their order either way', async () => {
      const { adapter, session } = harness();
      await adapter.start(input());
      const params = sessionParams(session);
      expect(params.success_url).toBe(
        'https://eventa.test/my/tickets/orders/o-1',
      );
      expect(params.cancel_url).toBe(
        'https://eventa.test/my/tickets/orders/o-1',
      );
    });

    it('sends the idempotency key so a retry cannot double-charge', async () => {
      const { adapter, session } = harness();
      await adapter.start(input());
      const [, options] = session.mock.calls[0] as [
        unknown,
        Stripe.RequestOptions,
      ];
      expect(options.idempotencyKey).toBe('idem-1');
      expect(options.stripeAccount).toBeUndefined();
    });

    it('charges on the workspace’s connected account when it has one', async () => {
      const { adapter, session } = harness();
      await adapter.start(input({ accountId: 'acct_123' }));
      const [, options] = session.mock.calls[0] as [
        unknown,
        Stripe.RequestOptions,
      ];
      expect(options.stripeAccount).toBe('acct_123');
    });

    it('sends the statement descriptor as a SUFFIX — cards reject the full form', async () => {
      const { adapter, session } = harness();
      await adapter.start(input({ statementDescriptor: 'Bangkok Tech Week' }));
      const intentData = sessionParams(session).payment_intent_data;
      expect(intentData?.statement_descriptor).toBeUndefined();
      expect(intentData?.statement_descriptor_suffix).toBe('Bangkok Tech');
    });

    it('drops a Thai descriptor rather than sending one Stripe will reject', async () => {
      const { adapter, session } = harness();
      await adapter.start(input({ statementDescriptor: 'งานเทคโนโลยี' }));
      expect(
        sessionParams(session).payment_intent_data?.statement_descriptor_suffix,
      ).toBeUndefined();
    });

    // On BOTH objects: the Session is what reconciles against the dashboard,
    // the intent is what the webhook carries.
    it('tags the session and its intent with the order, for reconciliation', async () => {
      const { adapter, session } = harness();
      await adapter.start(input());
      const params = sessionParams(session);
      expect(params.metadata).toEqual({ order_id: 'o-1', org_id: '7' });
      expect(params.payment_intent_data?.metadata).toEqual({
        order_id: 'o-1',
        org_id: '7',
      });
      expect(params.customer_email).toBe('anan@example.test');
      expect(params.payment_intent_data?.receipt_email).toBe(
        'anan@example.test',
      );
    });

    it('carries the deadline the session lapses at', async () => {
      const { adapter } = harness();
      expect((await adapter.start(input())).expiresAt).toEqual(
        new Date(SESSION_EXPIRES * 1000),
      );
    });
  });

  describe('start — PromptPay', () => {
    const qrIntent = {
      status: 'requires_action' as const,
      client_secret: 'pi_123_secret_abc',
      next_action: {
        type: 'promptpay_display_qr_code',
        promptpay_display_qr_code: {
          data: '00020101021229370016A000000677010111',
          hosted_instructions_url: 'https://stripe.test/qr',
          image_url_png: 'https://stripe.test/qr.png',
          image_url_svg: 'https://stripe.test/qr.svg',
        },
      } as unknown as Stripe.PaymentIntent.NextAction,
    };

    it('confirms in one call and returns the scannable payload', async () => {
      const { adapter, create } = harness(qrIntent);
      const result = await adapter.start(input({ method: 'PromptPay' }));

      const [params] = create.mock.calls[0] as [
        Stripe.PaymentIntentCreateParams,
      ];
      expect(params.payment_method_types).toEqual(['promptpay']);
      expect(params.payment_method_data?.type).toBe('promptpay');
      expect(params.confirm).toBe(true);
      expect(result.promptPayQr).toBe('00020101021229370016A000000677010111');
      expect(result.clientSecret).toBeNull();
    });

    it('carries the buyer’s email — a PromptPay refund is impossible without it', async () => {
      const { adapter, create } = harness(qrIntent);
      await adapter.start(input({ method: 'PromptPay' }));
      const [params] = create.mock.calls[0] as [
        Stripe.PaymentIntentCreateParams,
      ];
      expect(params.payment_method_data?.billing_details?.email).toBe(
        'anan@example.test',
      );
    });

    it('derives the deadline from the intent’s own creation time, not from now', async () => {
      const { adapter } = harness(qrIntent);
      const result = await adapter.start(input({ method: 'PromptPay' }));
      // Stripe exposes no expiry for PromptPay, so the TTL is ours — anchored to
      // `created` so an idempotent replay returns the SAME deadline.
      expect(result.expiresAt).toEqual(new Date((PI_CREATED + TTL) * 1000));
    });

    it('omits the statement descriptor — PromptPay ignores it entirely', async () => {
      const { adapter, create } = harness(qrIntent);
      await adapter.start(input({ method: 'PromptPay' }));
      const [params] = create.mock.calls[0] as [
        Stripe.PaymentIntentCreateParams,
      ];
      expect(params.statement_descriptor).toBeUndefined();
      expect(params.statement_descriptor_suffix).toBeUndefined();
    });
  });

  describe('start — guards', () => {
    it('refuses an amount below the Thai minimum without calling Stripe', async () => {
      const { adapter, create } = harness();
      const err = await adapter
        .start(input({ amountSatang: 5 * BAHT }))
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(422);
      expect(create).not.toHaveBeenCalled();
    });

    it('refuses an amount above what one payment can collect', async () => {
      const { adapter, create } = harness();
      await expect(
        adapter.start(input({ amountSatang: 100_000_000 })),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(create).not.toHaveBeenCalled();
    });

    it('accepts exactly the Thai minimum and maximum', async () => {
      // A card, so the hosted session is what gets opened.
      const { adapter, session } = harness();
      await adapter.start(input({ amountSatang: 1_000 }));
      await adapter.start(input({ amountSatang: 99_999_999 }));
      expect(session).toHaveBeenCalledTimes(2);
    });

    it('refuses a currency the method cannot settle in', async () => {
      const { adapter, create } = harness();
      await expect(
        adapter.start(input({ method: 'PromptPay', currency: 'USD' })),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(create).not.toHaveBeenCalled();
    });
  });

  /**
   * A hosted Session settles as `checkout.session.completed`.
   *
   * This is the event that MATTERS for a Checkout payment: `payment_intent`
   * is null when the session is created, so the reference stored at `start` is
   * the SESSION id — and `payment_intent.succeeded` carries a `pi_…` that
   * matches nothing. Settling on the session is what closes that gap.
   */
  describe('verifyWebhook — hosted checkout', () => {
    it('settles a completed session against the reference we stored', () => {
      const { adapter } = harness();
      const { raw, signature } = signed(checkoutSessionEvent());
      expect(adapter.verifyWebhook(raw, signature)).toMatchObject({
        eventId: 'evt_cs_1',
        type: 'succeeded',
        gatewayRef: 'cs_test_123',
        amountSatang: 210_000,
      });
    });

    /**
     * The intent id arrives with the completed session, and it is what a
     * refund needs later — so it is carried out for the service to reconcile
     * the stored reference onto.
     */
    it('carries the PaymentIntent the session finally created', () => {
      const { adapter } = harness();
      const { raw, signature } = signed(checkoutSessionEvent());
      expect(adapter.verifyWebhook(raw, signature).settledRef).toBe('pi_123');
    });

    it('reads the intent when Stripe expands it into an object', () => {
      const { adapter } = harness();
      const { raw, signature } = signed(
        checkoutSessionEvent({ payment_intent: { id: 'pi_456' } }),
      );
      expect(adapter.verifyWebhook(raw, signature).settledRef).toBe('pi_456');
    });

    // A session can complete while the money is still in flight — an async
    // method, or a delayed capture. Only `paid` is settled.
    it('ignores a session that completed without being paid', () => {
      const { adapter } = harness();
      const { raw, signature } = signed(
        checkoutSessionEvent({ payment_status: 'unpaid' }),
      );
      expect(adapter.verifyWebhook(raw, signature).type).toBe('ignored');
    });

    // The session lapsed before anybody paid: the hold should go back.
    it('expires a session the buyer abandoned', () => {
      const { adapter } = harness();
      const { raw, signature } = signed({
        id: 'evt_cs_2',
        object: 'event',
        type: 'checkout.session.expired',
        data: { object: { id: 'cs_test_123', object: 'checkout.session' } },
      });
      expect(adapter.verifyWebhook(raw, signature)).toMatchObject({
        type: 'expired',
        gatewayRef: 'cs_test_123',
      });
    });
  });

  describe('verifyWebhook', () => {
    it('settles on what actually landed — amount_received, not the amount asked for', () => {
      const { adapter } = harness();
      const { raw, signature } = signed(
        paymentIntentEvent('payment_intent.succeeded', {
          amount: 210_000,
          amount_received: 210_000,
        }),
      );
      const verified = adapter.verifyWebhook(raw, signature);
      expect(verified).toMatchObject({
        eventId: 'evt_1',
        type: 'succeeded',
        gatewayRef: 'pi_123',
        amountSatang: 210_000,
      });
    });

    it('reports a short payment as what actually arrived, so the service can refuse it', () => {
      const { adapter } = harness();
      const { raw, signature } = signed(
        paymentIntentEvent('payment_intent.succeeded', {
          amount: 210_000,
          amount_received: 100_000,
        }),
      );
      expect(adapter.verifyWebhook(raw, signature).amountSatang).toBe(100_000);
    });

    it('refuses a forged signature — the one input that could hand out free tickets', () => {
      const { adapter } = harness();
      const { raw } = signed(
        paymentIntentEvent('payment_intent.succeeded', {}),
      );
      const err = adapter.verifyWebhook.bind(adapter, raw, 't=1,v1=deadbeef');
      expect(err).toThrow(DomainException);
      expect(err).toThrow(/signature/i);
    });

    it('refuses a body that was re-serialised after signing', () => {
      const { adapter } = harness();
      const { signature } = signed(
        paymentIntentEvent('payment_intent.succeeded', {}),
      );
      const tampered = Buffer.from('{"id":"evt_1","type":"x"}', 'utf8');
      expect(() => adapter.verifyWebhook(tampered, signature)).toThrow(
        DomainException,
      );
    });

    it('maps a lapsed PromptPay QR to expired, so the seats go back', () => {
      const { adapter } = harness();
      const { raw, signature } = signed(
        paymentIntentEvent('payment_intent.payment_failed', {
          amount: 210_000,
          last_payment_error: {
            code: 'payment_intent_payment_attempt_expired',
            message: 'The payment attempt expired.',
          },
        }),
      );
      expect(adapter.verifyWebhook(raw, signature).type).toBe('expired');
    });

    it('maps an ordinary decline to failed, so the buyer keeps their seats to retry', () => {
      const { adapter } = harness();
      const { raw, signature } = signed(
        paymentIntentEvent('payment_intent.payment_failed', {
          amount: 210_000,
          last_payment_error: {
            code: 'card_declined',
            message: 'Your card was declined.',
          },
        }),
      );
      const verified = adapter.verifyWebhook(raw, signature);
      expect(verified.type).toBe('failed');
      expect(verified.declineReason).toBe('Your card was declined.');
    });

    it('treats a cancellation as expired', () => {
      const { adapter } = harness();
      const { raw, signature } = signed(
        paymentIntentEvent('payment_intent.canceled', { amount: 210_000 }),
      );
      expect(adapter.verifyWebhook(raw, signature).type).toBe('expired');
    });

    it('ignores everything it does not act on', () => {
      const { adapter } = harness();
      const { raw, signature } = signed({
        id: 'evt_2',
        object: 'event',
        type: 'charge.succeeded',
        data: { object: { id: 'ch_1', object: 'charge' } },
      });
      expect(adapter.verifyWebhook(raw, signature).type).toBe('ignored');
    });
  });

  describe('refund (US-FIN-02)', () => {
    function refundHarness(refund: Record<string, unknown> = {}) {
      const create = jest.fn().mockResolvedValue({
        id: 're_123',
        status: 'succeeded',
        failure_reason: null,
        ...refund,
      });
      const client = {
        refunds: { create },
        webhooks: real.webhooks,
      } as unknown as Stripe;
      return {
        adapter: new StripePaymentAdapter(clock, config(), client),
        create,
      };
    }

    const input = {
      gatewayRef: 'pi_123',
      amountSatang: 210_000,
      idempotencyKey: 'refund-1',
      accountId: null,
    };

    it('refunds the original intent, and says so on the idempotency key', async () => {
      const { adapter, create } = refundHarness();
      const result = await adapter.refund(input);
      const [params, options] = create.mock.calls[0] as [
        Stripe.RefundCreateParams,
        Stripe.RequestOptions,
      ];
      expect(params.payment_intent).toBe('pi_123');
      expect(params.amount).toBe(210_000);
      expect(options.idempotencyKey).toBe('refund-1');
      expect(result).toMatchObject({
        refundRef: 're_123',
        status: 'succeeded',
      });
    });

    it('refunds on the workspace’s connected account when it has one', async () => {
      const { adapter, create } = refundHarness();
      await adapter.refund({ ...input, accountId: 'acct_123' });
      const [, options] = create.mock.calls[0] as [
        unknown,
        Stripe.RequestOptions,
      ];
      expect(options.stripeAccount).toBe('acct_123');
    });

    it('reports a PromptPay refund awaiting the buyer’s bank details as pending', async () => {
      // Not a failure: Stripe emails the buyer for an account and settles later.
      const { adapter } = refundHarness({ status: 'pending' });
      expect((await adapter.refund(input)).status).toBe('pending');
    });

    it('reports a failed refund with its reason rather than throwing', async () => {
      const { adapter } = refundHarness({
        status: 'failed',
        failure_reason: 'expired_or_canceled_card',
      });
      const result = await adapter.refund(input);
      expect(result.status).toBe('failed');
      expect(result.failureReason).toBe('expired_or_canceled_card');
    });

    it('treats an unknown provider status as failed, never as money returned', async () => {
      const { adapter } = refundHarness({ status: 'requires_action' });
      expect((await adapter.refund(input)).status).toBe('failed');
    });
  });
});
