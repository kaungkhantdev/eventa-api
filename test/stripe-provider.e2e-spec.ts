process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://eventa:eventa@localhost:5432/eventa';
process.env.JWT_SECRET ??= 'test-secret-at-least-16-characters-long';

/**
 * Boot the app on the REAL Stripe provider. Test-mode credentials only — the
 * env schema refuses a live key outside production, and nothing here reaches
 * Stripe's network: the adapter's client is constructed but only its local
 * signature verification is exercised.
 */
const STRIPE_ENV = {
  PAYMENT_PROVIDER: 'stripe',
  STRIPE_SECRET_KEY: 'sk_test_e2e_not_a_real_key',
  STRIPE_WEBHOOK_SECRET: 'whsec_e2e_not_a_real_secret',
} as const;

const originals = new Map<string, string | undefined>();
for (const [key, value] of Object.entries(STRIPE_ENV)) {
  originals.set(key, process.env[key]);
  process.env[key] = value;
}

import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { buildValidationPipe } from '../src/common/http/validation';
import { PaymentProviderPort } from '../src/modules/payments/ports/payment-provider.port';
import { StripePaymentAdapter } from '../src/modules/payments/providers/stripe-payment.adapter';

describe('Stripe provider wiring (e2e — US-DISC-05)', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();
    server = app.getHttpServer() as Server;
  }, 30000);

  afterAll(async () => {
    await app.close();
    for (const [key, value] of originals) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('resolves the DI graph with the real adapter bound to the port', () => {
    // A green tsc does not prove this; only booting the container does.
    expect(app.get(PaymentProviderPort)).toBeInstanceOf(StripePaymentAdapter);
  });

  it('refuses an unsigned webhook — Stripe’s own verification is doing the work', async () => {
    const res = await request(server)
      .post('/api/v1/public/payments/webhook')
      .set('stripe-signature', 't=1,v1=forged')
      .set('content-type', 'application/json')
      .send({ id: 'evt_forged', type: 'payment_intent.succeeded' });
    expect(res.status).toBe(403);
  });

  it('refuses a webhook with no signature header at all', async () => {
    const res = await request(server)
      .post('/api/v1/public/payments/webhook')
      .set('content-type', 'application/json')
      .send({ id: 'evt_forged', type: 'payment_intent.succeeded' });
    expect(res.status).toBe(403);
  });
});
