import { createHmac } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { DomainException } from '../../../common/errors/domain.exception';
import type { Clock } from '../../../common/time/clock';
import type { Env } from '../../../config/env.validation';
import type { StartPaymentInput } from '../ports/payment-provider.port';
import { FakePaymentAdapter } from './fake-payment.adapter';

const NOW = new Date('2026-06-01T00:00:00Z');
const SECRET = 'whsec_test';
const TTL = 900;
const BAHT = 100;

/** No default here on purpose — passing `undefined` must mean "unset". */
function configFor(secret: string | undefined): ConfigService<Env, true> {
  return {
    get: () => secret,
    getOrThrow: () => TTL,
  } as unknown as ConfigService<Env, true>;
}

const clock: Clock = { now: () => NOW };

function adapter(): FakePaymentAdapter {
  return new FakePaymentAdapter(clock, configFor(SECRET));
}

/** An adapter with STRIPE_WEBHOOK_SECRET genuinely unset. */
function adapterWithoutSecret(): FakePaymentAdapter {
  return new FakePaymentAdapter(clock, configFor(undefined));
}

function input(o: Partial<StartPaymentInput> = {}): StartPaymentInput {
  return {
    orderId: 'o-1',
    organizationId: 7,
    amountSatang: 2_100 * BAHT,
    currency: 'THB',
    method: 'Card',
    buyerEmail: 'anan@example.test',
    statementDescriptor: 'EVENTA',
    accountId: null,
    idempotencyKey: 'idem-1',
    ...o,
  };
}

const sign = (body: string, secret = SECRET) =>
  createHmac('sha256', secret).update(Buffer.from(body)).digest('hex');

describe('FakePaymentAdapter (US-DISC-05)', () => {
  describe('start', () => {
    it('hands a card buyer a client secret, never anything card-shaped', async () => {
      const res = await adapter().start(input({ method: 'Card' }));
      expect(res.status).toBe('requires_action');
      expect(res.clientSecret).toContain('_secret');
      expect(res.promptPayQr).toBeNull();
    });

    it('hands a PromptPay buyer a scannable code with a deadline', async () => {
      const res = await adapter().start(input({ method: 'PromptPay' }));
      expect(res.promptPayQr).toMatch(/^0002010102/);
      expect(res.clientSecret).toBeNull();
      expect(res.expiresAt).toEqual(new Date(NOW.getTime() + TTL * 1_000));
    });

    it('returns the same reference for a retried idempotency key', async () => {
      const first = await adapter().start(input({ idempotencyKey: 'k-1' }));
      const again = await adapter().start(input({ idempotencyKey: 'k-1' }));
      expect(again.gatewayRef).toBe(first.gatewayRef);
    });

    it('returns a different reference for a genuinely different attempt', async () => {
      const first = await adapter().start(input({ idempotencyKey: 'k-1' }));
      const other = await adapter().start(input({ idempotencyKey: 'k-2' }));
      expect(other.gatewayRef).not.toBe(first.gatewayRef);
    });

    it('declines the magic test buyer, with a reason worth showing', async () => {
      const res = await adapter().start(
        input({ buyerEmail: 'decline@example.test' }),
      );
      expect(res.status).toBe('failed');
      expect(res.declineReason).toMatch(/declined/i);
      expect(res.clientSecret).toBeNull();
    });
  });

  describe('verifyWebhook', () => {
    const body = JSON.stringify({
      eventId: 'evt_1',
      type: 'succeeded',
      gatewayRef: 'fake_pi_abc',
      amountSatang: 2_100 * BAHT,
    });

    it('accepts a correctly signed callback', () => {
      const res = adapter().verifyWebhook(Buffer.from(body), sign(body));
      expect(res).toMatchObject({
        eventId: 'evt_1',
        type: 'succeeded',
        gatewayRef: 'fake_pi_abc',
        amountSatang: 2_100 * BAHT,
      });
    });

    it('refuses a callback signed with the wrong secret', () => {
      expect(() =>
        adapter().verifyWebhook(Buffer.from(body), sign(body, 'whsec_wrong')),
      ).toThrow(DomainException);
    });

    it('refuses a callback whose body was altered after signing', () => {
      const signature = sign(body);
      const tampered = body.replace('2100', '1');
      expect(() =>
        adapter().verifyWebhook(Buffer.from(tampered), signature),
      ).toThrow(/signature/i);
    });

    it('refuses a callback with no signature at all', () => {
      expect(() => adapter().verifyWebhook(Buffer.from(body), '')).toThrow(
        DomainException,
      );
    });

    it('refuses a signature of the wrong length without crashing', () => {
      // timingSafeEqual throws on a length mismatch — this must be a clean 403.
      const err = (() => {
        try {
          adapter().verifyWebhook(Buffer.from(body), 'short');
          return null;
        } catch (e) {
          return e;
        }
      })();
      expect((err as DomainException).getStatus()).toBe(403);
    });

    it('treats an unrecognised callback as nothing to act on', () => {
      const other = JSON.stringify({ eventId: 'evt_2', gatewayRef: 'x' });
      const res = adapter().verifyWebhook(Buffer.from(other), sign(other));
      expect(res.type).toBe('ignored');
    });

    it('still verifies when no webhook secret is configured', () => {
      // `fake` needs no credentials, but must not therefore skip the check.
      const noSecret = adapterWithoutSecret();
      const signed = sign(body, 'whsec_fake');
      expect(noSecret.verifyWebhook(Buffer.from(body), signed).type).toBe(
        'succeeded',
      );
      expect(() =>
        noSecret.verifyWebhook(Buffer.from(body), sign(body, 'nope')),
      ).toThrow(DomainException);
    });
  });

  describe('refund (US-FIN-02)', () => {
    const input = {
      gatewayRef: 'fake_pi_abc',
      amountSatang: 210_000,
      idempotencyKey: 'refund-1',
      accountId: null,
    };

    it('gives a stable reference for a key, so a retry refunds once', async () => {
      const first = await adapter().refund(input);
      const second = await adapter().refund(input);
      expect(first.refundRef).toBe(second.refundRef);
      expect(first.status).toBe('succeeded');
    });

    it('gives different references to different refunds', async () => {
      const a = await adapter().refund(input);
      const b = await adapter().refund({
        ...input,
        idempotencyKey: 'refund-2',
      });
      expect(a.refundRef).not.toBe(b.refundRef);
    });
  });
});
