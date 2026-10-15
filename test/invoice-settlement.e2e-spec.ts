process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://eventa:eventa@localhost:5432/eventa';
process.env.JWT_SECRET ??= 'test-secret-at-least-16-characters-long';

import { createHmac } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { buildValidationPipe } from '../src/common/http/validation';
import { PaymentProviderPort } from '../src/modules/payments/ports/payment-provider.port';
import { BANGKOK_TODAY_SQL } from './support/bangkok-day';
import { listenOnLoopback } from './support/loopback';
import { StubPaymentProvider } from './support/stub-payment.provider';

const PASSWORD = 'correct horse battery staple';
const ORG = { slug: 'inv-money-e2e', name: 'Invoice Money E2E' };
const ADMIN = 'admin@inv-money-e2e.test';
const GRANTS = ['finView', 'finManage', 'finRefund'];
const BAHT = 100;
/** ฿1,000 ×2 + 5% fee — what the placed order comes to. */
const ORDER_TOTAL = 2_100 * BAHT;
/** The stub provider's signing secret (see test/support/stub-payment.provider). */
const WEBHOOK_SECRET = 'whsec_fake';
const WEBHOOK_TOKEN = 'tok-invmoney-e2e';
const EVENT_PREFIX = 'evt-invmoney-';

interface Success<T> {
  data: T;
}
interface Invoice {
  id: number;
  status: string;
  paidVia: string | null;
  paidOn: string | null;
  canVoid: boolean;
}
interface Counts {
  issued: number;
  paid: number;
  overdue: number;
  void: number;
}

/**
 * An invoice follows the money behind its order (US-FIN-02, US-FIN-06/07).
 *
 * Both halves used to be missing. An invoice issued while its order was unpaid
 * was stamped once, at issue, so a buyer who then paid had it age to Overdue
 * with no paid details. And a refunded sale's invoice stayed Paid for good,
 * though a paid invoice can only be voided by refunding its payment.
 */
describe('An invoice follows its order’s money (e2e — US-FIN-02/06/07)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let orgId: number;
  let eventId: string;
  let tierId: string;
  let adminJwt: string;
  let seq = 0;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    ({ orgId, eventId, tierId } = await seed(pool));

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // The suite must not reach Stripe's network; see payments.e2e-spec.
      .overrideProvider(PaymentProviderPort)
      .useClass(StubPaymentProvider)
      .compile();
    // rawBody: the webhook signature covers the exact bytes sent.
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await listenOnLoopback(app);
    server = app.getHttpServer() as Server;

    const res = await request(server).post('/api/v1/auth/login').send({
      email: ADMIN,
      password: PASSWORD,
      orgSlug: ORG.slug,
      persona: 'admin',
    });
    adminJwt = (res.body as Success<{ accessToken: string }>).data.accessToken;
  }, 30000);

  afterEach(async () => {
    for (const table of [
      'invoices',
      'refunds',
      'payments',
      'tickets',
      'order_items',
      'seat_holds',
      'orders',
      'outbox_events',
      'audit_events',
    ]) {
      await pool.query(`DELETE FROM ${table} WHERE organization_id = $1`, [
        orgId,
      ]);
    }
    await pool.query(
      `DELETE FROM webhook_events WHERE provider_event_id LIKE $1`,
      [`${EVENT_PREFIX}%`],
    );
    await pool.query(`UPDATE ticket_types SET sold = 0 WHERE id = $1`, [
      tierId,
    ]);
  });

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  const nextKey = (label: string) => {
    seq += 1;
    return `${label}-${seq}-${ORG.slug}`;
  };

  /** A pending paid order, placed the way a buyer would: hold, then confirm. */
  const placeOrder = async (): Promise<string> => {
    const held = await request(server)
      .post('/api/v1/public/checkout/hold')
      .send({ eventId, ticketTypeId: tierId, quantity: 2 });
    expect(held.status).toBe(201);
    const holdIds = (held.body as Success<{ holdIds: number[] }>).data.holdIds;
    const placed = await request(server)
      .post('/api/v1/public/checkout/confirm')
      .send({
        eventId,
        ticketTypeId: tierId,
        quantity: 2,
        holdIds,
        buyer: {
          name: 'Anan Suksawat',
          email: 'anan@inv-money.test',
          phone: '+66812345678',
        },
        idempotencyKey: nextKey('order'),
      });
    expect(placed.status).toBe(201);
    return (placed.body as Success<{ orderId: string }>).data.orderId;
  };

  /** Start a payment; answers its id. */
  const pay = async (orderId: string, method: string): Promise<string> => {
    const res = await request(server)
      .post('/api/v1/public/payments')
      .send({ orderId, method, idempotencyKey: nextKey('pay') });
    expect(res.status).toBe(201);
    return (res.body as Success<{ paymentId: string }>).data.paymentId;
  };

  /** The provider reports the payment's money arrived. */
  const settle = async (paymentId: string) => {
    const { rows } = await pool.query<{ gateway_ref: string }>(
      `SELECT gateway_ref FROM payments WHERE id = $1`,
      [paymentId],
    );
    seq += 1;
    const raw = JSON.stringify({
      eventId: `${EVENT_PREFIX}${seq}`,
      type: 'succeeded',
      gatewayRef: rows[0].gateway_ref,
      amountSatang: ORDER_TOTAL,
    });
    const res = await request(server)
      .post(`/api/v1/public/payments/webhook/${WEBHOOK_TOKEN}`)
      .set(
        'stripe-signature',
        createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex'),
      )
      .set('content-type', 'application/json')
      .send(raw);
    expect(res.status).toBe(200);
  };

  const issue = async (orderId: string): Promise<Invoice> => {
    const res = await request(server)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ orderId });
    expect(res.status).toBe(201);
    return (res.body as Success<Invoice>).data;
  };

  const invoice = async (id: number): Promise<Invoice> => {
    const res = await request(server)
      .get(`/api/v1/invoices/${id}`)
      .set('Authorization', `Bearer ${adminJwt}`);
    expect(res.status).toBe(200);
    return (res.body as Success<Invoice>).data;
  };

  const counts = async (): Promise<Counts> => {
    const res = await request(server)
      .get('/api/v1/invoices')
      .set('Authorization', `Bearer ${adminJwt}`);
    return (res.body as { meta: { counts: Counts } }).meta.counts;
  };

  const refund = (paymentId: string) =>
    request(server)
      .post(`/api/v1/payments/${paymentId}/refund`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ idempotencyKey: nextKey('refund') });

  const bangkokToday = async (): Promise<string> => {
    const { rows } = await pool.query<{ today: string }>(
      `SELECT to_char(${BANGKOK_TODAY_SQL}, 'YYYY-MM-DD') AS today`,
    );
    return rows[0].today;
  };

  describe('the money arrives after the invoice was issued (US-FIN-06/07)', () => {
    it('reads Paid, with how and when, once the payment settles', async () => {
      const orderId = await placeOrder();
      const paymentId = await pay(orderId, 'PromptPay');
      const issued = await issue(orderId);
      expect(issued.status).toBe('issued');

      await settle(paymentId);

      const paid = await invoice(issued.id);
      expect(paid.status).toBe('paid');
      expect(paid.paidVia).toBe('PromptPay');
      expect(paid.paidOn).toBe(await bangkokToday());
    });

    it('never ages a settled invoice to Overdue', async () => {
      const orderId = await placeOrder();
      const paymentId = await pay(orderId, 'Card');
      const issued = await issue(orderId);
      await settle(paymentId);
      // Its 14-day term ran out three days ago.
      await pool.query(
        `UPDATE invoices SET issued_at = ${BANGKOK_TODAY_SQL} - 17,
                             due_at = ${BANGKOK_TODAY_SQL} - 3 WHERE id = $1`,
        [issued.id],
      );
      expect((await invoice(issued.id)).status).toBe('paid');
      expect(await counts()).toEqual({
        issued: 0,
        paid: 1,
        overdue: 0,
        void: 0,
      });
    });
  });

  describe('the money goes back (US-FIN-02)', () => {
    it('voids the invoice of a refunded sale and drops it out of receivables', async () => {
      const orderId = await placeOrder();
      const paymentId = await pay(orderId, 'Card');
      await settle(paymentId);
      const issued = await issue(orderId);
      expect(issued.status).toBe('paid');

      const res = await refund(paymentId);
      expect(res.status).toBe(200);

      const voided = await invoice(issued.id);
      expect(voided.status).toBe('void');
      expect(voided.canVoid).toBe(false);
      expect(await counts()).toEqual({
        issued: 0,
        paid: 0,
        overdue: 0,
        void: 1,
      });
    });

    it('records the void in the audit trail as the refunder’s', async () => {
      const orderId = await placeOrder();
      const paymentId = await pay(orderId, 'Card');
      await settle(paymentId);
      await issue(orderId);
      await refund(paymentId);
      const { rows } = await pool.query<{ title: string; email: string }>(
        `SELECT a.title, u.email FROM audit_events a
           JOIN users u ON u.id = a.actor_user_id
          WHERE a.organization_id = $1 AND a.title LIKE 'Voided invoice%'`,
        [orgId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toMatch(/^Voided invoice INV-/);
      expect(rows[0].email).toBe(ADMIN);
    });

    it('leaves the invoice Paid when only a duplicate payment goes back', async () => {
      const orderId = await placeOrder();
      const first = await pay(orderId, 'Card');
      const duplicate = await pay(orderId, 'PromptPay');
      await settle(first);
      // The old QR scanned after the card had paid: a second settled payment.
      await settle(duplicate);
      const issued = await issue(orderId);

      expect((await refund(duplicate)).status).toBe(200);

      expect((await invoice(issued.id)).status).toBe('paid');
    });
  });
});

async function seed(
  pool: Pool,
): Promise<{ orgId: number; eventId: string; tierId: string }> {
  const org = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug, vat_rate, service_fee_rate)
     VALUES ($1, $2, 0.0700, 0.0500) RETURNING id`,
    [ORG.name, ORG.slug],
  );
  const orgId = Number(org.rows[0].id);
  await seedAdmin(pool, orgId);
  const event = await pool.query<{ id: string }>(
    `INSERT INTO events (organization_id, slug, name, type, bucket, status, visibility,
                         start_at, timezone, organizer_name, venue_name, city, published_at)
     VALUES ($1, 'inv-money-summit', 'Invoice Money Summit', 'Conference', 'active',
             'upcoming', 'public', now() + interval '30 days', 'Asia/Bangkok', 'Acme',
             'QSNCC', 'Bangkok', now())
     RETURNING id`,
    [orgId],
  );
  const tier = await pool.query<{ id: string }>(
    `INSERT INTO ticket_types (organization_id, event_id, name, price_satang,
                               status, total, sold, min_per_order, max_per_order)
     VALUES ($1, $2, 'General', $3, 'onsale', 100, 0, 1, 8) RETURNING id`,
    [orgId, event.rows[0].id, 1_000 * BAHT],
  );
  await pool.query(
    `INSERT INTO payment_settings (organization_id, provider, status, account_id, webhook_token)
     VALUES ($1, 'stripe', 'connected', 'acct_invmoney', $2)`,
    [orgId, WEBHOOK_TOKEN],
  );
  return { orgId, eventId: event.rows[0].id, tierId: tier.rows[0].id };
}

async function seedAdmin(pool: Pool, orgId: number): Promise<void> {
  for (const key of GRANTS) {
    await pool.query(
      `INSERT INTO permissions (key, "group", label) VALUES ($1, 'Finance', $2)
       ON CONFLICT (key) DO NOTHING`,
      [key, key],
    );
  }
  // Not a built-in role (`is_system` false), so sign-in leaves its grants alone.
  const role = await pool.query<{ id: string }>(
    `INSERT INTO roles (organization_id, name, description, is_system)
     VALUES ($1, 'Admin', 'seed', false) RETURNING id`,
    [orgId],
  );
  for (const key of GRANTS) {
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_key, granted) VALUES ($1, $2, true)`,
      [role.rows[0].id, key],
    );
  }
  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
     VALUES ($1, 'Seed', $2, 'admin', 'Active', $3) RETURNING id`,
    [orgId, ADMIN, await hash(PASSWORD)],
  );
  await pool.query(
    `INSERT INTO memberships (organization_id, user_id, role_id, role, status)
     VALUES ($1, $2, $3, 'Admin', 'Active')`,
    [orgId, user.rows[0].id, role.rows[0].id],
  );
}

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM webhook_events WHERE provider_event_id LIKE $1`,
    [`${EVENT_PREFIX}%`],
  );
  // audit_events is ON DELETE RESTRICT (a sign-in writes one), so clear it first.
  await pool.query(
    `DELETE FROM audit_events WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug = $1)`,
    [ORG.slug],
  );
  await pool.query(
    `DELETE FROM refunds WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug = $1)`,
    [ORG.slug],
  );
  await pool.query(`DELETE FROM organizations WHERE slug = $1`, [ORG.slug]);
}
