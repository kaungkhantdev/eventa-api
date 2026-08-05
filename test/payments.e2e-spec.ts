process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://eventa:eventa@localhost:5432/eventa';
process.env.JWT_SECRET ??= 'test-secret-at-least-16-characters-long';

import { createHmac } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { buildValidationPipe } from '../src/common/http/validation';

const ORG = { slug: 'pay-e2e', name: 'Pay E2E' };
const SUMMIT = 'pay-summit';
const BAHT = 100;
/** ฿1,000 ×2 + 5% fee — what the seeded order comes to. */
const ORDER_TOTAL = 2_100 * BAHT;
/** The fake adapter's default secret when STRIPE_WEBHOOK_SECRET is unset. */
const WEBHOOK_SECRET = 'whsec_fake';

interface Success<T> {
  data: T;
}
interface Placed {
  orderId: string;
  status: string;
  paymentRequired: boolean;
  tickets: unknown[];
}
interface Intent {
  paymentId: string;
  orderId: string;
  status: string;
  amountSatang: number;
  amountLabel: string;
  clientSecret: string | null;
  promptPayQr: string | null;
  expiresAt: string | null;
  declineReason: string | null;
}

describe('Paying for an order (e2e — US-DISC-05)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let orgId: number;
  let eventId: string;
  let tierId: string;
  let seq = 0;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    ({ orgId, eventId, tierId } = await seed(pool));

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    // rawBody: the webhook signature covers the exact bytes sent.
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();
    server = app.getHttpServer() as Server;
  }, 30000);

  afterEach(async () => {
    await pool.query(`DELETE FROM payments WHERE organization_id = $1`, [
      orgId,
    ]);
    await pool.query(`DELETE FROM orders WHERE organization_id = $1`, [orgId]);
    await pool.query(`DELETE FROM seat_holds WHERE organization_id = $1`, [
      orgId,
    ]);
    await pool.query(`DELETE FROM outbox_events WHERE organization_id = $1`, [
      orgId,
    ]);
    await pool.query(
      `DELETE FROM webhook_events WHERE provider_event_id LIKE 'evt-paye2e-%'`,
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

  /** Place a pending paid order the way a buyer would: hold, then confirm. */
  const placeOrder = async (buyerEmail = 'anan@pay.test'): Promise<string> => {
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
          email: buyerEmail,
          phone: '+66812345678',
        },
        idempotencyKey: nextKey('order'),
      });
    expect(placed.status).toBe(201);
    const p = (placed.body as Success<Placed>).data;
    expect(p.status).toBe('pending');
    expect(p.tickets).toEqual([]);
    return p.orderId;
  };

  const pay = (orderId: string, method = 'Card', key = nextKey('pay')) =>
    request(server)
      .post('/api/v1/public/payments')
      .send({ orderId, method, idempotencyKey: key });

  const gatewayRefOf = async (orderId: string): Promise<string> => {
    const { rows } = await pool.query<{ gateway_ref: string }>(
      `SELECT gateway_ref FROM payments WHERE order_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [orderId],
    );
    return rows[0].gateway_ref;
  };

  const webhook = (body: object, secret = WEBHOOK_SECRET) => {
    const raw = JSON.stringify(body);
    const signature = createHmac('sha256', secret).update(raw).digest('hex');
    return request(server)
      .post('/api/v1/public/payments/webhook')
      .set('stripe-signature', signature)
      .set('content-type', 'application/json')
      .send(raw);
  };

  const settleByWebhook = async (
    orderId: string,
    overrides: Record<string, unknown> = {},
  ) => {
    seq += 1;
    return webhook({
      eventId: `evt-paye2e-${seq}`,
      type: 'succeeded',
      gatewayRef: await gatewayRefOf(orderId),
      amountSatang: ORDER_TOTAL,
      ...overrides,
    });
  };

  const orderState = async (orderId: string) => {
    const { rows } = await pool.query<{
      status: string;
      payment_status: string;
    }>(`SELECT status, payment_status FROM orders WHERE id = $1`, [orderId]);
    return rows[0];
  };

  const ticketCount = async (orderId: string): Promise<number> => {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM tickets WHERE order_id = $1`,
      [orderId],
    );
    return Number(rows[0].n);
  };

  describe('starting a payment', () => {
    it('charges the order’s total and hands back the card hand-off', async () => {
      const orderId = await placeOrder();
      const res = await pay(orderId);
      expect(res.status).toBe(201);
      const intent = (res.body as Success<Intent>).data;
      expect(intent.amountSatang).toBe(ORDER_TOTAL);
      expect(intent.amountLabel).toBe('฿2,100');
      expect(intent.clientSecret).toBeTruthy();
      expect(intent.promptPayQr).toBeNull();
      expect(intent.status).toBe('pending');
    });

    it('hands a PromptPay buyer a QR for the exact total, with a deadline', async () => {
      const orderId = await placeOrder();
      const intent = ((await pay(orderId, 'PromptPay')).body as Success<Intent>)
        .data;
      expect(intent.promptPayQr).toBeTruthy();
      expect(intent.clientSecret).toBeNull();
      expect(Date.parse(intent.expiresAt ?? '')).toBeGreaterThan(Date.now());
    });

    it('ignores any amount a hostile client tries to send', async () => {
      const orderId = await placeOrder();
      const res = await request(server)
        .post('/api/v1/public/payments')
        .send({
          orderId,
          method: 'Card',
          idempotencyKey: nextKey('pay'),
          amountSatang: 1,
        });
      // forbidNonWhitelisted: an amount field is refused, not ignored.
      expect(res.status).toBe(400);
    });

    it('replaying the same attempt returns the same payment, once', async () => {
      const orderId = await placeOrder();
      const key = nextKey('pay');
      const first = ((await pay(orderId, 'Card', key)).body as Success<Intent>)
        .data;
      const again = ((await pay(orderId, 'Card', key)).body as Success<Intent>)
        .data;
      expect(again.paymentId).toBe(first.paymentId);
      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM payments WHERE order_id = $1`,
        [orderId],
      );
      expect(Number(rows[0].n)).toBe(1);
    });

    it('tells a declined buyer plainly, issues nothing, and allows a retry', async () => {
      const orderId = await placeOrder('decline@pay.test');
      const intent = ((await pay(orderId)).body as Success<Intent>).data;
      expect(intent.status).toBe('failed');
      expect(intent.declineReason).toMatch(/declined/i);
      expect(await ticketCount(orderId)).toBe(0);
      expect((await orderState(orderId)).status).toBe('pending');
      // The buyer may try again — a new attempt is accepted.
      expect((await pay(orderId, 'PromptPay')).status).toBe(201);
    });

    it('404s for an order that does not exist', async () => {
      const res = await pay('00000000-0000-4000-8000-0000000000ff');
      expect(res.status).toBe(404);
    });

    it('refuses an already-paid order', async () => {
      const orderId = await placeOrder();
      await pay(orderId);
      await settleByWebhook(orderId);
      const res = await pay(orderId, 'Card', nextKey('pay'));
      expect(res.status).toBe(409);
      expect((res.body as { message: string }).message).toMatch(/already/i);
    });
  });

  describe('the webhook settles the order', () => {
    it('issues the tickets when the money arrives — and only then', async () => {
      const orderId = await placeOrder();
      await pay(orderId);
      expect(await ticketCount(orderId)).toBe(0);

      const res = await settleByWebhook(orderId);
      expect(res.status).toBe(200);
      expect(await ticketCount(orderId)).toBe(2);
      expect(await orderState(orderId)).toEqual({
        status: 'confirmed',
        payment_status: 'paid',
      });
      const { rows } = await pool.query<{ status: string; paid_at: Date }>(
        `SELECT status, paid_at FROM payments WHERE order_id = $1`,
        [orderId],
      );
      expect(rows[0].status).toBe('paid');
      expect(rows[0].paid_at).not.toBeNull();
    });

    it('counts the sale and frees the holds', async () => {
      const orderId = await placeOrder();
      await pay(orderId);
      await settleByWebhook(orderId);
      const { rows: tier } = await pool.query<{ sold: number }>(
        `SELECT sold FROM ticket_types WHERE id = $1`,
        [tierId],
      );
      expect(tier[0].sold).toBe(2);
      const { rows: holds } = await pool.query<{ status: string }>(
        `SELECT status FROM seat_holds WHERE organization_id = $1`,
        [orgId],
      );
      expect(holds.every((h) => h.status === 'converted')).toBe(true);
    });

    it('queues the paid confirmation with its VAT receipt flag', async () => {
      const orderId = await placeOrder();
      await pay(orderId);
      await settleByWebhook(orderId);
      const { rows } = await pool.query<{
        routing_key: string;
        payload: { paid: boolean; ticketCount: number };
      }>(
        `SELECT routing_key, payload FROM outbox_events WHERE organization_id = $1`,
        [orgId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].routing_key).toBe('registration.confirmed');
      expect(rows[0].payload.paid).toBe(true);
      expect(rows[0].payload.ticketCount).toBe(2);
    });

    it('replaying the same provider event changes nothing', async () => {
      const orderId = await placeOrder();
      await pay(orderId);
      const ref = await gatewayRefOf(orderId);
      const body = {
        eventId: 'evt-paye2e-replay',
        type: 'succeeded',
        gatewayRef: ref,
        amountSatang: ORDER_TOTAL,
      };
      expect((await webhook(body)).status).toBe(200);
      expect((await webhook(body)).status).toBe(200);
      expect(await ticketCount(orderId)).toBe(2);
    });

    it('a second success for the same order never doubles the tickets', async () => {
      const orderId = await placeOrder();
      await pay(orderId);
      await settleByWebhook(orderId);
      await settleByWebhook(orderId); // fresh event id, same gateway ref
      expect(await ticketCount(orderId)).toBe(2);
      const { rows } = await pool.query<{ sold: number }>(
        `SELECT sold FROM ticket_types WHERE id = $1`,
        [tierId],
      );
      expect(rows[0].sold).toBe(2);
    });

    it('refuses an unsigned or tampered callback outright', async () => {
      const orderId = await placeOrder();
      await pay(orderId);
      const res = await settleByWebhook(orderId, {});
      expect(res.status).toBe(200); // control: a good one passes

      const bad = await webhook(
        {
          eventId: 'evt-paye2e-forged',
          type: 'succeeded',
          gatewayRef: await gatewayRefOf(orderId),
          amountSatang: ORDER_TOTAL,
        },
        'whsec_wrong',
      );
      expect(bad.status).toBe(403);
    });

    it('never settles on a mismatched amount', async () => {
      const orderId = await placeOrder();
      await pay(orderId);
      await settleByWebhook(orderId, { amountSatang: 1 });
      expect(await ticketCount(orderId)).toBe(0);
      expect((await orderState(orderId)).status).toBe('pending');
    });

    it('a failed payment keeps the order open for another try', async () => {
      const orderId = await placeOrder();
      await pay(orderId);
      await settleByWebhook(orderId, { type: 'failed' });
      expect((await orderState(orderId)).status).toBe('pending');
      expect(await ticketCount(orderId)).toBe(0);
      // Seats stay held — the buyer is mid-retry, not gone.
      const { rows } = await pool.query<{ status: string }>(
        `SELECT status FROM seat_holds WHERE organization_id = $1`,
        [orgId],
      );
      expect(rows.every((h) => h.status === 'active')).toBe(true);
    });

    it('an expired PromptPay code releases the seats for someone else', async () => {
      const orderId = await placeOrder();
      await pay(orderId, 'PromptPay');
      await settleByWebhook(orderId, { type: 'expired' });
      expect(await ticketCount(orderId)).toBe(0);
      const { rows } = await pool.query<{ status: string }>(
        `SELECT status FROM seat_holds WHERE organization_id = $1`,
        [orgId],
      );
      expect(rows.every((h) => h.status === 'released')).toBe(true);
      // …and the buyer can simply ask for a fresh code.
      expect((await pay(orderId, 'PromptPay')).status).toBe(201);
    });

    it('cancels and queues a refund when the tickets sold out mid-payment', async () => {
      const orderId = await placeOrder();
      await pay(orderId);
      // Everyone else bought the remaining stock while the buyer was paying.
      await pool.query(`UPDATE ticket_types SET sold = total WHERE id = $1`, [
        tierId,
      ]);
      await settleByWebhook(orderId);

      expect(await ticketCount(orderId)).toBe(0);
      expect((await orderState(orderId)).status).toBe('cancelled');
      const { rows } = await pool.query<{ routing_key: string }>(
        `SELECT routing_key FROM outbox_events WHERE organization_id = $1`,
        [orgId],
      );
      expect(rows.map((r) => r.routing_key)).toEqual([
        'payment.refund_required',
      ]);
    });
  });
});

async function seed(
  pool: Pool,
): Promise<{ orgId: number; eventId: string; tierId: string }> {
  const org = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug, vat_rate, service_fee_rate, statement_descriptor)
     VALUES ($1,$2,0.0700,0.0500,'EVENTA*SUMMIT') RETURNING id`,
    [ORG.name, ORG.slug],
  );
  const orgId = Number(org.rows[0].id);
  const event = await pool.query<{ id: string }>(
    `INSERT INTO events (organization_id, slug, name, type, bucket, status, visibility,
                         start_at, timezone, organizer_name, venue_name, city, published_at)
     VALUES ($1,$2,'Pay Summit','Conference','active','upcoming','public',
             now() + interval '30 days','Asia/Bangkok','Acme','QSNCC','Bangkok', now())
     RETURNING id`,
    [orgId, SUMMIT],
  );
  const tier = await pool.query<{ id: string }>(
    `INSERT INTO ticket_types (organization_id, event_id, name, price_satang,
                               status, total, sold, min_per_order, max_per_order)
     VALUES ($1,$2,'General',$3,'onsale',100,0,1,8) RETURNING id`,
    [orgId, event.rows[0].id, 1_000 * BAHT],
  );
  return { orgId, eventId: event.rows[0].id, tierId: tier.rows[0].id };
}

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM webhook_events WHERE provider_event_id LIKE 'evt-paye2e-%'`,
  );
  await pool.query(`DELETE FROM organizations WHERE slug = $1`, [ORG.slug]);
}
