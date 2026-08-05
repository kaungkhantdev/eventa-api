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
  create: jest.Mock;
}

function harness(intent: Partial<Stripe.PaymentIntent> = {}): Harness {
  const create = jest.fn().mockResolvedValue({
    id: 'pi_123',
    status: 'requires_action',
    client_secret: 'pi_123_secret_abc',
    created: PI_CREATED,
    next_action: null,
    last_payment_error: null,
    ...intent,
  });
  const client = {
    paymentIntents: { create },
    webhooks: real.webhooks,
  } as unknown as Stripe;
  return {
    adapter: new StripePaymentAdapter(clock, config(), client),
    create,
  };
}

function input(o: Partial<StartPaymentInput> = {}): StartPaymentInput {
  return {
    orderId: 'o-1',
    organizationId: 7,
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

describe('StripePaymentAdapter (US-DISC-05)', () => {
  describe('start — card', () => {
    it('asks for the order total in satang, in lowercase thb, and hands back the client secret', async () => {
      const { adapter, create } = harness();
      const result = await adapter.start(input());

      const [params] = create.mock.calls[0] as [
        Stripe.PaymentIntentCreateParams,
      ];
      expect(params.amount).toBe(210_000);
      expect(params.currency).toBe('thb');
      expect(params.payment_method_types).toEqual(['card']);
      // A card PI is NOT confirmed here — the buyer confirms in hosted fields.
      expect(params.confirm).toBeUndefined();
      expect(result.gatewayRef).toBe('pi_123');
      expect(result.clientSecret).toBe('pi_123_secret_abc');
      expect(result.promptPayQr).toBeNull();
      expect(result.expiresAt).toBeNull();
      expect(result.status).toBe('requires_action');
    });

    it('sends the idempotency key so a retry cannot double-charge', async () => {
      const { adapter, create } = harness();
      await adapter.start(input());
      const [, options] = create.mock.calls[0] as [
        unknown,
        Stripe.RequestOptions,
      ];
      expect(options.idempotencyKey).toBe('idem-1');
      expect(options.stripeAccount).toBeUndefined();
    });

    it('charges on the workspace’s connected account when it has one', async () => {
      const { adapter, create } = harness();
      await adapter.start(input({ accountId: 'acct_123' }));
      const [, options] = create.mock.calls[0] as [
        unknown,
        Stripe.RequestOptions,
      ];
      expect(options.stripeAccount).toBe('acct_123');
    });

    it('sends the statement descriptor as a SUFFIX — cards reject the full form', async () => {
      const { adapter, create } = harness();
      await adapter.start(input({ statementDescriptor: 'Bangkok Tech Week' }));
      const [params] = create.mock.calls[0] as [
        Stripe.PaymentIntentCreateParams,
      ];
      expect(params.statement_descriptor).toBeUndefined();
      expect(params.statement_descriptor_suffix).toBe('Bangkok Tech');
    });

    it('drops a Thai descriptor rather than sending one Stripe will reject', async () => {
      const { adapter, create } = harness();
      await adapter.start(input({ statementDescriptor: 'งานเทคโนโลยี' }));
      const [params] = create.mock.calls[0] as [
        Stripe.PaymentIntentCreateParams,
      ];
      expect(params.statement_descriptor_suffix).toBeUndefined();
    });

    it('reports a declined intent as failed, with a reason', async () => {
      const { adapter } = harness({
        status: 'requires_payment_method',
        last_payment_error: {
          message: 'Your card was declined.',
          code: 'card_declined',
        } as Stripe.PaymentIntent.LastPaymentError,
      });
      const result = await adapter.start(input());
      expect(result.status).toBe('failed');
      expect(result.declineReason).toBe('Your card was declined.');
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

    it('refuses a currency the method cannot settle in', async () => {
      const { adapter, create } = harness();
      await expect(
        adapter.start(input({ method: 'PromptPay', currency: 'USD' })),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(create).not.toHaveBeenCalled();
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
});
