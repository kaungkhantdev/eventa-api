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
import { PaymentProviderPort } from '../src/modules/payments/ports/payment-provider.port';
import { StubPaymentProvider } from './support/stub-payment.provider';
import { buildValidationPipe } from '../src/common/http/validation';

const PASSWORD = 'correct horse battery staple';
const ORG = { slug: 'mypay-e2e', name: 'MyPay E2E' };
const ANAN = 'anan@mypay.test';
const MALEE = 'malee@mypay.test';
const BAHT = 100;
/** ฿1,000 ×2 + 5% fee. */
const ORDER_TOTAL = 2_100 * BAHT;
const WEBHOOK_SECRET = 'whsec_fake';

interface Success<T> {
  data: T;
}
interface Summary {
  totalSpentSatang: number;
  totalRefundedSatang: number;
  transactionCount: number;
  totalSpentLabel: string;
}
interface Txn {
  paymentId: string;
  reference: string;
  eventName: string;
  method: string;
  status: string;
  amountLabel: string;
}

describe('Payment history (e2e — US-DISC-10)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let anan: string;
  let paidPaymentId: string;
  let refundedPaymentId: string;
  let maleePaymentId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    const seeded = await seed(pool);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      // The shipped app has ONE payment provider and it is the real Stripe
      // adapter. The suite must not reach Stripe's network, so it supplies its
      // own stand-in here — in the test layer, where a double belongs.
      .overrideProvider(PaymentProviderPort)
      .useClass(StubPaymentProvider)
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();
    server = app.getHttpServer() as Server;

    // ANAN's paid transaction goes through the REAL money path:
    // guest checkout → pay → signed webhook → settled ledger row.
    paidPaymentId = await payThroughTheFrontDoor(
      server,
      pool,
      seeded.eventId,
      seeded.tierId,
      ANAN,
    );
    refundedPaymentId = seeded.refundedPaymentId;
    maleePaymentId = seeded.maleePaymentId;
    anan = await signIn(server, ANAN);
  }, 30000);

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  const get = (path: string, token: string) =>
    request(server)
      .get(`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`);

  it('shows the three tiles, with refunds excluded from spend', async () => {
    const res = await get('/me/payments/summary', anan);
    expect(res.status).toBe(200);
    const s = (res.body as Success<Summary>).data;
    expect(s.totalSpentSatang).toBe(ORDER_TOTAL);
    expect(s.totalRefundedSatang).toBe(500 * BAHT);
    expect(s.transactionCount).toBe(2);
    expect(s.totalSpentLabel).toBe('฿2,100');
  });

  it('lists my transactions with event, invoice number, method and status', async () => {
    const res = await get('/me/payments', anan);
    expect(res.status).toBe(200);
    const rows = (res.body as { data: Txn[] }).data;
    expect(rows).toHaveLength(2);
    const paid = rows.find((r) => r.status === 'paid');
    expect(paid).toMatchObject({
      eventName: 'MyPay Summit',
      method: 'Card',
      amountLabel: '฿2,100',
    });
    expect(paid?.reference).toMatch(/^ORD-/);
    expect(rows.some((r) => r.status === 'refunded')).toBe(true);
  });

  it('never lists a pending or failed attempt as a transaction', async () => {
    const rows = ((await get('/me/payments', anan)).body as { data: Txn[] })
      .data;
    expect(rows.map((r) => r.status).sort()).toEqual(['paid', 'refunded']);
  });

  it('never shows anyone else’s transactions', async () => {
    const malee = await signIn(server, MALEE);
    const rows = ((await get('/me/payments', malee)).body as { data: Txn[] })
      .data;
    expect(rows).toHaveLength(1);
    expect(rows[0].paymentId).toBe(maleePaymentId);
  });

  it('downloads a VAT receipt with the 7% breakdown in Baht', async () => {
    const res = await get(`/me/payments/${paidPaymentId}/receipt.svg`, anan);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/svg/);
    const svg = (res.body as Buffer).toString();
    expect(svg).toContain('VAT Receipt');
    expect(svg).toContain('VAT 7%');
    expect(svg).toContain('฿2,100'); // total
    expect(svg).toContain('MyPay Summit');
    expect(svg).toContain('0105561234567'); // the workspace tax id
  });

  it('marks a refunded transaction’s receipt REFUNDED', async () => {
    const res = await get(
      `/me/payments/${refundedPaymentId}/receipt.svg`,
      anan,
    );
    expect(res.status).toBe(200);
    expect((res.body as Buffer).toString()).toContain('REFUNDED');
  });

  it('refuses a receipt that belongs to someone else', async () => {
    expect(
      (await get(`/me/payments/${maleePaymentId}/receipt.svg`, anan)).status,
    ).toBe(404);
  });

  it('exports the full history as CSV', async () => {
    const res = await get('/me/payments/export.csv', anan);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const csv = res.text ?? (res.body as Buffer).toString();
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe(
      'date,reference,event,method,status,amount_baht,vat_baht',
    );
    expect(lines).toHaveLength(3); // header + 2 transactions
    expect(csv).toContain('2100.00');
  });

  it('shows zero tiles and an empty list for a fresh attendee', async () => {
    await pool.query(
      `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
       SELECT id, 'Fresh', 'fresh@mypay.test', 'attendee', 'Active', $1
       FROM organizations WHERE slug = 'eventa'`,
      [await hash(PASSWORD)],
    );
    const fresh = await signIn(server, 'fresh@mypay.test');
    const s = (
      (await get('/me/payments/summary', fresh)).body as Success<Summary>
    ).data;
    expect(s).toMatchObject({
      totalSpentSatang: 0,
      totalRefundedSatang: 0,
      transactionCount: 0,
    });
    expect(
      ((await get('/me/payments', fresh)).body as { data: Txn[] }).data,
    ).toEqual([]);
  });

  it('requires a signed-in attendee', async () => {
    expect((await request(server).get('/api/v1/me/payments')).status).toBe(401);
  });
});

async function signIn(server: Server, email: string): Promise<string> {
  const res = await request(server)
    .post('/api/v1/auth/login')
    .send({ email, password: PASSWORD, persona: 'attendee' });
  expect(res.status).toBe(200);
  return (res.body as Success<{ accessToken: string }>).data.accessToken;
}

/** The real money path: hold → confirm → pay → signed success webhook. */
async function payThroughTheFrontDoor(
  server: Server,
  pool: Pool,
  eventId: string,
  ticketTypeId: string,
  buyerEmail: string,
): Promise<string> {
  const held = await request(server)
    .post('/api/v1/public/checkout/hold')
    .send({ eventId, ticketTypeId, quantity: 2 });
  const placed = await request(server)
    .post('/api/v1/public/checkout/confirm')
    .send({
      eventId,
      ticketTypeId,
      quantity: 2,
      holdIds: (held.body as Success<{ holdIds: number[] }>).data.holdIds,
      buyer: { name: 'Anan Suksawat', email: buyerEmail },
      idempotencyKey: `mypay-order-${buyerEmail}`,
    });
  const orderId = (placed.body as Success<{ orderId: string }>).data.orderId;
  const paid = await request(server)
    .post('/api/v1/public/payments')
    .send({
      orderId,
      method: 'Card',
      idempotencyKey: `mypay-pay-${buyerEmail}`,
    });
  expect(paid.status).toBe(201);
  const intent = (paid.body as Success<{ paymentId: string }>).data;

  const { rows } = await pool.query<{ gateway_ref: string }>(
    `SELECT gateway_ref FROM payments WHERE id = $1`,
    [intent.paymentId],
  );
  const body = JSON.stringify({
    eventId: `evt-mypay-${buyerEmail}`,
    type: 'succeeded',
    gatewayRef: rows[0].gateway_ref,
    amountSatang: ORDER_TOTAL,
  });
  const signature = createHmac('sha256', WEBHOOK_SECRET)
    .update(body)
    .digest('hex');
  const hook = await request(server)
    .post('/api/v1/public/payments/webhook')
    .set('stripe-signature', signature)
    .set('content-type', 'application/json')
    .send(body);
  expect(hook.status).toBe(200);
  return intent.paymentId;
}

interface Seeded {
  eventId: string;
  tierId: string;
  refundedPaymentId: string;
  maleePaymentId: string;
}

async function seed(pool: Pool): Promise<Seeded> {
  const org = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug, vat_rate, service_fee_rate, tax_id, address)
     VALUES ($1,$2,0.0700,0.0500,'0105561234567','88 Bangna, Bangkok') RETURNING id`,
    [ORG.name, ORG.slug],
  );
  const orgId = Number(org.rows[0].id);
  const passwordHash = await hash(PASSWORD);
  for (const email of [ANAN, MALEE]) {
    await pool.query(
      `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
       SELECT id, 'Attendee', $1, 'attendee', 'Active', $2
       FROM organizations WHERE slug = 'eventa'`,
      [email, passwordHash],
    );
  }
  const event = await pool.query<{ id: string }>(
    `INSERT INTO events (organization_id, slug, name, type, bucket, status, visibility,
                         start_at, timezone, organizer_name, venue_name, city, published_at)
     VALUES ($1,'mypay-summit','MyPay Summit','Conference','active','upcoming','public',
             now() + interval '30 days','Asia/Bangkok','Acme','QSNCC','Bangkok', now())
     RETURNING id`,
    [orgId],
  );
  const eventId = event.rows[0].id;
  const tier = await pool.query<{ id: string }>(
    `INSERT INTO ticket_types (organization_id, event_id, name, price_satang,
                               status, total, sold, min_per_order, max_per_order)
     VALUES ($1,$2,'General',$3,'onsale',100,0,1,8) RETURNING id`,
    [orgId, eventId, 1_000 * BAHT],
  );

  const refundedPaymentId = await seedPayment(
    pool,
    orgId,
    eventId,
    ANAN,
    'MYPAY-REF-1',
    500 * BAHT,
    'refunded',
  );
  // A failed attempt that must NEVER appear as a transaction.
  await seedPayment(
    pool,
    orgId,
    eventId,
    ANAN,
    'MYPAY-FAIL-1',
    900 * BAHT,
    'failed',
  );
  const maleePaymentId = await seedPayment(
    pool,
    orgId,
    eventId,
    MALEE,
    'MYPAY-MALEE-1',
    300 * BAHT,
    'paid',
  );
  return {
    eventId,
    tierId: tier.rows[0].id,
    refundedPaymentId,
    maleePaymentId,
  };
}

let seedSeq = 0;

async function seedPayment(
  pool: Pool,
  orgId: number,
  eventId: string,
  email: string,
  reference: string,
  amountSatang: number,
  status: string,
): Promise<string> {
  seedSeq += 1;
  const vat = Math.round((amountSatang * 7) / 107);
  const order = await pool.query<{ id: string }>(
    `INSERT INTO orders (organization_id, reference, event_id, buyer_name, buyer_email,
                         status, payment_status, seats, subtotal_satang, vat_amount_satang, total_satang)
     VALUES ($1,$2,$3,'Seeded',$4,'confirmed',$5::payment_status,1,$6,$7,$6) RETURNING id`,
    [
      orgId,
      reference,
      eventId,
      email,
      status === 'failed' ? 'pending' : status,
      amountSatang,
      vat,
    ],
  );
  const payment = await pool.query<{ id: string }>(
    `INSERT INTO payments (organization_id, txn, order_id, event_id, payer_name, method,
                           amount_satang, status, paid_at, idempotency_key)
     VALUES ($1,$2,$3,$4,'Seeded','PromptPay',$5,$6::payment_status,
             CASE WHEN $6::text <> 'failed' THEN now() - ($7 || ' hours')::interval ELSE NULL END,$8)
     RETURNING id`,
    [
      orgId,
      `seed_txn_${reference}`,
      order.rows[0].id,
      eventId,
      amountSatang,
      status,
      String(seedSeq),
      `seed-idem-${reference}`,
    ],
  );
  return payment.rows[0].id;
}

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM webhook_events WHERE provider_event_id LIKE 'evt-mypay-%'`,
  );
  await pool.query(
    `DELETE FROM outbox_events WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug = $1)`,
    [ORG.slug],
  );
  await pool.query(
    `DELETE FROM outbox_events WHERE aggregate_id IN
       (SELECT id::text FROM users WHERE email LIKE '%@mypay.test')`,
  );
  await pool.query(`DELETE FROM users WHERE email LIKE '%@mypay.test'`);
  await pool.query(`DELETE FROM organizations WHERE slug = $1`, [ORG.slug]);
}
