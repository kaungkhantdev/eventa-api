process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://eventa:eventa@localhost:5432/eventa';
process.env.JWT_SECRET ??= 'test-secret-at-least-16-characters-long';

/**
 * Boot the app on the REAL Stripe provider — with no Stripe key anywhere, which
 * is the point. Keys belong to a workspace and are read per call from its own
 * encrypted row, so the app starts, wires the adapter and rejects a forged
 * callback without one. Nothing here reaches Stripe's network: only the local
 * signature check runs, and that is pure HMAC.
 */
const STRIPE_ENV = {
  PAYMENT_PROVIDER: 'stripe',
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

const WEBHOOK = '/api/v1/public/payments/webhook';
/** Well-formed but belonging to no workspace — nothing is seeded here. */
const KNOWN_SHAPE_TOKEN = 'whk_e2e_no_workspace_owns_this';
const UNKNOWN_TOKEN = 'whk_nobody_at_all';

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

  it('refuses a forged signature — Stripe’s own verification is doing the work', async () => {
    const res = await request(server)
      .post(`${WEBHOOK}/${KNOWN_SHAPE_TOKEN}`)
      .set('stripe-signature', 't=1,v1=forged')
      .set('content-type', 'application/json')
      .send({ id: 'evt_forged', type: 'payment_intent.succeeded' });
    expect(res.status).toBe(403);
  });

  it('refuses a callback with no signature header at all', async () => {
    const res = await request(server)
      .post(`${WEBHOOK}/${KNOWN_SHAPE_TOKEN}`)
      .set('content-type', 'application/json')
      .send({ id: 'evt_forged', type: 'payment_intent.succeeded' });
    expect(res.status).toBe(403);
  });

  /**
   * The property that keeps the tokenised URL from being an oracle.
   *
   * Each workspace registers its own endpoint, so the token in the path is the
   * only thing naming whose signing secret to verify against — and a token
   * nobody owns has to be refused the SAME way a forged signature is. A 404
   * here would let a stranger enumerate which workspaces take payments by
   * watching the status code change.
   */
  it('refuses an unknown token exactly as it refuses a forgery', async () => {
    const res = await request(server)
      .post(`${WEBHOOK}/${UNKNOWN_TOKEN}`)
      .set('stripe-signature', 't=1,v1=forged')
      .set('content-type', 'application/json')
      .send({ id: 'evt_forged', type: 'payment_intent.succeeded' });
    expect(res.status).toBe(403);
  });
});
