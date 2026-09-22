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
import { PaymentsRepository } from '../src/modules/payments/payments.repository';
import { listenOnLoopback } from './support/loopback';
import {
  PENDING_REFUND_PREFIX,
  StubPaymentProvider,
} from './support/stub-payment.provider';

const PASSWORD = 'correct horse battery staple';
const ORG = { slug: 'pending-refund-e2e', name: 'Pending Refund E2E' };
/** A second workspace, to prove its URL cannot finish the first one's refund. */
const OTHER_ORG = {
  slug: 'pending-refund-e2e-other',
  name: 'Pending Refund E2E Other',
};
const ADMIN = 'admin@pending-refund-e2e.test';
const GRANTS = ['finView', 'finRefund', 'regView', 'regManage'];
const PRICE = 100_000;
/** The stub provider's signing secret (see test/support/stub-payment.provider). */
const WEBHOOK_SECRET = 'whsec_fake';
const WEBHOOK_TOKEN = 'tok-pendrf-e2e';
const OTHER_WEBHOOK_TOKEN = 'tok-pendrf-e2e-other';
const EVENT_PREFIX = 'evt-pendrf-';
/** The seeded tier: sold out, across a 2-ticket order and a 1-ticket order. */
const TIER_TOTAL = 3;
const REFUNDED_SEATS = 2;

interface Success<T> {
  data: T;
}

interface Seeded {
  eventId: string;
  tierId: string;
  orderId: string;
  paymentId: string;
  /** The 1-ticket order that is never refunded — a double return would eat it. */
  bystanderOrderId: string;
}

/**
 * A refund the provider settles later (US-FIN-02), against the real schema and
 * the whole module graph.
 *
 * A PromptPay refund comes back `pending` — Stripe must first email the buyer
 * for their bank details — and nothing finished it: the refund row never kept
 * the provider's reference, and the webhook only understood payments. The
 * tickets stayed valid and the place stayed sold for good, whatever the bank
 * did. Here the provider's refund callback finishes it: voids the tickets,
 * returns the stock, flips the ledger — exactly once.
 */
describe('A refund the provider settles later (e2e — US-FIN-02)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let orgId: number;
  let adminJwt: string;
  let seq = 0;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    orgId = await seedOrg(pool);
    await seedOtherOrg(pool);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
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
    jest.restoreAllMocks();
    for (const table of [
      'refunds',
      'payments',
      'seat_assignments',
      'seat_holds',
      'tickets',
      'order_items',
      'orders',
      'outbox_events',
      'ticket_types',
      'events',
    ]) {
      await pool.query(`DELETE FROM ${table} WHERE organization_id = $1`, [
        orgId,
      ]);
    }
    await pool.query(
      `DELETE FROM webhook_events WHERE provider_event_id LIKE $1`,
      [`${EVENT_PREFIX}%`],
    );
  });

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  /** A sold-out tier: one refundable 2-ticket order, one 1-ticket bystander. */
  async function seed(): Promise<Seeded> {
    seq += 1;
    const event = await pool.query<{ id: string }>(
      `INSERT INTO events (organization_id, slug, name, type, bucket, status, visibility,
                           start_at, timezone, organizer_name, published_at)
       VALUES ($1, $2, 'Pending Refund Summit', 'Conference', 'active', 'upcoming', 'public',
               now() + interval '30 days', 'Asia/Bangkok', 'Acme', now())
       RETURNING id`,
      [orgId, `pending-refund-${seq}`],
    );
    const eventId = event.rows[0].id;
    const tier = await pool.query<{ id: string }>(
      `INSERT INTO ticket_types (organization_id, event_id, name, price_satang,
                                 status, total, sold, min_per_order, max_per_order)
       VALUES ($1, $2, 'General', $3, 'onsale', $4, $4, 1, 8) RETURNING id`,
      [orgId, eventId, PRICE, TIER_TOTAL],
    );
    const tierId = tier.rows[0].id;
    const refundable = await paidOrder(
      eventId,
      tierId,
      REFUNDED_SEATS,
      `${PENDING_REFUND_PREFIX}${seq}`,
    );
    const bystander = await paidOrder(
      eventId,
      tierId,
      TIER_TOTAL - REFUNDED_SEATS,
      `fake_pi_pendrf_bystander_${seq}`,
    );
    return {
      eventId,
      tierId,
      orderId: refundable.orderId,
      paymentId: refundable.paymentId,
      bystanderOrderId: bystander.orderId,
    };
  }

  /** A paid, confirmed order holding `seats` live tickets on the tier. */
  async function paidOrder(
    eventId: string,
    tierId: string,
    seats: number,
    gatewayRef: string,
  ): Promise<{ orderId: string; paymentId: string }> {
    seq += 1;
    const total = PRICE * seats;
    const order = await pool.query<{ id: string }>(
      `INSERT INTO orders (organization_id, reference, event_id, buyer_name, buyer_email,
                           status, payment_status, seats, subtotal_satang, total_satang)
       VALUES ($1, $2, $3, 'Malee', 'malee@pending-refund.test', 'confirmed', 'paid', $4, $5, $5)
       RETURNING id`,
      [orgId, `PRF-${seq}`, eventId, seats, total],
    );
    const orderId = order.rows[0].id;
    const item = await pool.query<{ id: string }>(
      `INSERT INTO order_items (organization_id, order_id, ticket_type_id, quantity,
                                unit_price_satang, line_subtotal_satang)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [orgId, orderId, tierId, seats, PRICE, total],
    );
    for (let i = 0; i < seats; i += 1) {
      await pool.query(
        `INSERT INTO tickets (organization_id, order_id, order_item_id, event_id,
                              ticket_type_id, qr_token, holder_name, ticket_label, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'Malee', 'General', 'issued')`,
        [
          orgId,
          orderId,
          item.rows[0].id,
          eventId,
          tierId,
          `PRF-QR-${seq}-${i}`,
        ],
      );
    }
    const payment = await pool.query<{ id: string }>(
      `INSERT INTO payments (organization_id, txn, order_id, event_id, payer_name, method,
                             amount_satang, status, paid_at, gateway_ref, idempotency_key)
       VALUES ($1, $2, $3, $4, 'Malee', 'PromptPay', $5, 'paid', now(), $6, $7)
       RETURNING id`,
      [
        orgId,
        `PRF-TXN-${seq}`,
        orderId,
        eventId,
        total,
        gatewayRef,
        `prf-pay-${seq}`,
      ],
    );
    return { orderId, paymentId: payment.rows[0].id };
  }

  /**
   * A second payment that settled the same order — the documented duplicate:
   * the old PromptPay QR scanned after the card had already paid.
   */
  async function duplicatePayment(
    s: Seeded,
    method: 'Card' | 'PromptPay',
    gatewayRef: string,
  ): Promise<string> {
    seq += 1;
    const payment = await pool.query<{ id: string }>(
      `INSERT INTO payments (organization_id, txn, order_id, event_id, payer_name, method,
                             amount_satang, status, paid_at, gateway_ref, idempotency_key)
       VALUES ($1, $2, $3, $4, 'Malee', $5, $6, 'paid', now(), $7, $8)
       RETURNING id`,
      [
        orgId,
        `PRF-TXN-${seq}`,
        s.orderId,
        s.eventId,
        method,
        PRICE * REFUNDED_SEATS,
        gatewayRef,
        `prf-pay-${seq}`,
      ],
    );
    return payment.rows[0].id;
  }

  const refund = (paymentId: string) => {
    seq += 1;
    return request(server)
      .post(`/api/v1/payments/${paymentId}/refund`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ idempotencyKey: `prf-refund-${seq}-${Date.now()}` });
  };

  const webhook = (body: object, token = WEBHOOK_TOKEN) => {
    const raw = JSON.stringify(body);
    const signature = createHmac('sha256', WEBHOOK_SECRET)
      .update(raw)
      .digest('hex');
    return request(server)
      .post(`/api/v1/public/payments/webhook/${token}`)
      .set('stripe-signature', signature)
      .set('content-type', 'application/json')
      .send(raw);
  };

  /** A refund callback, the way the stub provider reads one. */
  const refundEvent = (gatewayRef: string, o: Record<string, unknown> = {}) => {
    seq += 1;
    return {
      eventId: `${EVENT_PREFIX}${seq}`,
      type: 'refund_succeeded',
      gatewayRef,
      amountSatang: PRICE * REFUNDED_SEATS,
      declineReason: null,
      ...o,
    };
  };

  const refundOf = async (paymentId: string) =>
    (
      await pool.query<{
        status: string;
        gateway_ref: string | null;
        reason: string | null;
      }>(
        `SELECT status, gateway_ref, reason FROM refunds WHERE payment_id = $1`,
        [paymentId],
      )
    ).rows[0];

  const refundRefOf = async (paymentId: string): Promise<string> => {
    const ref = (await refundOf(paymentId)).gateway_ref;
    if (!ref) throw new Error('the pending refund kept no provider reference');
    return ref;
  };

  const soldOf = async (tierId: string): Promise<number> =>
    (
      await pool.query<{ sold: number }>(
        `SELECT sold FROM ticket_types WHERE id = $1`,
        [tierId],
      )
    ).rows[0].sold;

  const ticketStatuses = async (orderId: string): Promise<string[]> =>
    (
      await pool.query<{ status: string }>(
        `SELECT status FROM tickets WHERE order_id = $1 ORDER BY qr_token`,
        [orderId],
      )
    ).rows.map((r) => r.status);

  const paymentStatus = async (paymentId: string): Promise<string> =>
    (
      await pool.query<{ status: string }>(
        `SELECT status FROM payments WHERE id = $1`,
        [paymentId],
      )
    ).rows[0].status;

  const orderState = async (orderId: string) =>
    (
      await pool.query<{ status: string; payment_status: string }>(
        `SELECT status, payment_status FROM orders WHERE id = $1`,
        [orderId],
      )
    ).rows[0];

  const webhookRow = async (eventId: string) =>
    (
      await pool.query<{ status: string; organization_id: string | null }>(
        `SELECT status, organization_id FROM webhook_events WHERE provider_event_id = $1`,
        [eventId],
      )
    ).rows[0];

  const holdOne = (eventId: string, tierId: string) =>
    request(server)
      .post('/api/v1/public/checkout/hold')
      .send({ eventId, ticketTypeId: tierId, quantity: 1 });

  /** Everything a finished (or unfinished) refund could have moved. */
  const snapshot = async (s: Seeded) => ({
    sold: await soldOf(s.tierId),
    tickets: await ticketStatuses(s.orderId),
    bystander: await ticketStatuses(s.bystanderOrderId),
    payment: await paymentStatus(s.paymentId),
    refund: (await refundOf(s.paymentId)).status,
    order: await orderState(s.orderId),
  });

  const UNTOUCHED = {
    sold: TIER_TOTAL,
    tickets: ['issued', 'issued'],
    bystander: ['issued'],
    payment: 'paid',
    refund: 'pending',
    order: { status: 'confirmed', payment_status: 'paid' },
  };

  describe('while the buyer’s bank details are outstanding', () => {
    it('frees nothing, but keeps the provider’s reference for the webhook to find', async () => {
      const s = await seed();

      const res = await refund(s.paymentId).expect(200);

      expect((res.body as Success<{ status: string }>).data.status).toBe(
        'pending',
      );
      expect(await snapshot(s)).toEqual(UNTOUCHED);
      expect((await refundOf(s.paymentId)).gateway_ref).toMatch(/^fake_re_/);
    });
  });

  describe('when the provider reports the refund succeeded', () => {
    it('voids the tickets, returns exactly their places, and flips the ledger', async () => {
      const s = await seed();
      await refund(s.paymentId).expect(200);
      expect((await holdOne(s.eventId, s.tierId)).status).toBe(409);
      const event = refundEvent(await refundRefOf(s.paymentId));

      const res = await webhook(event).expect(200);

      expect(res.body).toEqual({ received: true });
      expect(await snapshot(s)).toEqual({
        sold: TIER_TOTAL - REFUNDED_SEATS,
        tickets: ['refunded', 'refunded'],
        bystander: ['issued'],
        payment: 'refunded',
        refund: 'succeeded',
        order: { status: 'cancelled', payment_status: 'refunded' },
      });
      expect(await webhookRow(event.eventId)).toEqual({
        status: 'processed',
        organization_id: String(orgId),
      });
      expect((await holdOne(s.eventId, s.tierId)).status).toBe(201);
    });

    it('changes nothing more when the same news arrives again', async () => {
      const s = await seed();
      await refund(s.paymentId).expect(200);
      const ref = await refundRefOf(s.paymentId);
      const first = refundEvent(ref);
      await webhook(first).expect(200);
      const settled = await snapshot(s);

      // The same event redelivered, and a second event about the same refund
      // (Stripe sends refund.updated more than once over a refund's life).
      await webhook(first).expect(200);
      const second = refundEvent(ref);
      await webhook(second).expect(200);

      expect(await snapshot(s)).toEqual(settled);
      expect(settled.sold).toBe(TIER_TOTAL - REFUNDED_SEATS);
      expect((await webhookRow(second.eventId)).status).toBe('processed');
    });
  });

  describe('when the provider reports the refund failed', () => {
    it('keeps the tickets valid and records why', async () => {
      const s = await seed();
      await refund(s.paymentId).expect(200);
      const event = refundEvent(await refundRefOf(s.paymentId), {
        type: 'refund_failed',
        declineReason: 'insufficient_funds',
      });

      await webhook(event).expect(200);

      expect(await snapshot(s)).toEqual({ ...UNTOUCHED, refund: 'failed' });
      expect((await refundOf(s.paymentId)).reason).toBe('insufficient_funds');
      expect((await webhookRow(event.eventId)).status).toBe('processed');
    });
  });

  /**
   * An order two payments settled. The buyer paid twice and bought once, so
   * refunding the extra payment gives back money, never the tickets the other
   * payment still pays for.
   */
  describe('a duplicate payment, while another payment still covers the order', () => {
    /** Everything the covering payment bought — a duplicate's refund leaves it all. */
    const covered = async (s: Seeded) => ({
      sold: await soldOf(s.tierId),
      tickets: await ticketStatuses(s.orderId),
      bystander: await ticketStatuses(s.bystanderOrderId),
      covering: await paymentStatus(s.paymentId),
      order: await orderState(s.orderId),
    });

    const STILL_COVERED = {
      sold: TIER_TOTAL,
      tickets: ['issued', 'issued'],
      bystander: ['issued'],
      covering: 'paid',
      order: { status: 'confirmed', payment_status: 'paid' },
    };

    it('refunded at once, gives the money back and leaves the tickets issued', async () => {
      const s = await seed();
      const duplicate = await duplicatePayment(
        s,
        'Card',
        `fake_pi_pendrf_duplicate_${seq}`,
      );

      const res = await refund(duplicate).expect(200);

      expect((res.body as Success<{ status: string }>).data.status).toBe(
        'succeeded',
      );
      expect(await covered(s)).toEqual(STILL_COVERED);
      expect(await paymentStatus(duplicate)).toBe('refunded');
      expect((await refundOf(duplicate)).status).toBe('succeeded');
    });

    it('settled later by the webhook, gives the money back and leaves the tickets issued', async () => {
      const s = await seed();
      const duplicate = await duplicatePayment(
        s,
        'PromptPay',
        `${PENDING_REFUND_PREFIX}duplicate_${seq}`,
      );
      await refund(duplicate).expect(200);

      await webhook(refundEvent(await refundRefOf(duplicate))).expect(200);

      expect(await covered(s)).toEqual(STILL_COVERED);
      expect(await paymentStatus(duplicate)).toBe('refunded');
      expect((await refundOf(duplicate)).status).toBe('succeeded');
    });

    it('once the duplicate is back, refunding the payment that bought the tickets voids them', async () => {
      const s = await seed();
      const duplicate = await duplicatePayment(
        s,
        'Card',
        `fake_pi_pendrf_duplicate_${seq}`,
      );
      await refund(duplicate).expect(200);
      await refund(s.paymentId).expect(200);

      await webhook(refundEvent(await refundRefOf(s.paymentId))).expect(200);

      expect(await covered(s)).toEqual({
        sold: TIER_TOTAL - REFUNDED_SEATS,
        tickets: ['refunded', 'refunded'],
        bystander: ['issued'],
        covering: 'refunded',
        order: { status: 'cancelled', payment_status: 'refunded' },
      });
    });
  });

  /**
   * A success and a failure about the same refund, processed at the same
   * moment. Both read the row while it was still pending; only the first
   * write may land. The stale read is replayed through the real repository so
   * the guarded writes — and the rolled-back ticket void — run against the
   * real schema.
   */
  describe('two outcomes for one refund, processed at the same time', () => {
    const readBeforeTheOtherLanded = async (ref: string) => {
      const repo = app.get(PaymentsRepository);
      const stale = await repo.findRefundByGatewayRef(orgId, ref);
      return () =>
        jest.spyOn(repo, 'findRefundByGatewayRef').mockResolvedValueOnce(stale);
    };

    it('a success that lost to a failure voids nothing and returns no stock', async () => {
      const s = await seed();
      await refund(s.paymentId).expect(200);
      const ref = await refundRefOf(s.paymentId);
      const replayStaleRead = await readBeforeTheOtherLanded(ref);
      await webhook(
        refundEvent(ref, {
          type: 'refund_failed',
          declineReason: 'insufficient_funds',
        }),
      ).expect(200);
      replayStaleRead();

      const late = refundEvent(ref);
      await webhook(late).expect(200);

      expect(await snapshot(s)).toEqual({ ...UNTOUCHED, refund: 'failed' });
      expect((await webhookRow(late.eventId)).status).toBe('processed');
    });

    it('a failure that lost to the settlement leaves it standing, flagged for a person', async () => {
      const s = await seed();
      await refund(s.paymentId).expect(200);
      const ref = await refundRefOf(s.paymentId);
      const replayStaleRead = await readBeforeTheOtherLanded(ref);
      await webhook(refundEvent(ref)).expect(200);
      const settled = await snapshot(s);
      replayStaleRead();

      const late = refundEvent(ref, {
        type: 'refund_failed',
        declineReason: 'insufficient_funds',
      });
      await webhook(late).expect(200);

      expect(await snapshot(s)).toEqual(settled);
      expect(settled.refund).toBe('succeeded');
      expect((await webhookRow(late.eventId)).status).toBe('failed');
    });
  });

  describe('callbacks that must not move anything', () => {
    it('acknowledges a refund it has no record of, and changes nothing', async () => {
      const s = await seed();
      await refund(s.paymentId).expect(200);
      const event = refundEvent('fake_re_nobody');

      const res = await webhook(event).expect(200);

      expect(res.body).toEqual({ received: true });
      expect(await snapshot(s)).toEqual(UNTOUCHED);
      expect(await webhookRow(event.eventId)).toEqual({
        status: 'processed',
        organization_id: null,
      });
    });

    it('refuses to settle a refund for a different amount than was asked', async () => {
      const s = await seed();
      await refund(s.paymentId).expect(200);
      const event = refundEvent(await refundRefOf(s.paymentId), {
        amountSatang: PRICE,
      });

      await webhook(event).expect(200);

      expect(await snapshot(s)).toEqual(UNTOUCHED);
      expect((await webhookRow(event.eventId)).status).toBe('failed');
    });

    it('will not let another workspace’s callback URL finish this refund', async () => {
      const s = await seed();
      await refund(s.paymentId).expect(200);
      const event = refundEvent(await refundRefOf(s.paymentId));

      await webhook(event, OTHER_WEBHOOK_TOKEN).expect(200);

      expect(await snapshot(s)).toEqual(UNTOUCHED);
    });
  });
});

async function seedOrg(pool: Pool): Promise<number> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
    [ORG.name, ORG.slug],
  );
  const orgId = Number(res.rows[0].id);
  for (const key of GRANTS) {
    await pool.query(
      `INSERT INTO permissions (key, "group", label) VALUES ($1, 'Finance', $2)
       ON CONFLICT (key) DO NOTHING`,
      [key, key],
    );
  }
  const role = await pool.query<{ id: string }>(
    `INSERT INTO roles (organization_id, name, description) VALUES ($1, 'Admin', 'seed') RETURNING id`,
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
  // Refunds reverse on the workspace's own connected account, and its
  // callbacks arrive on its own URL.
  await pool.query(
    `INSERT INTO payment_settings (organization_id, provider, status, account_id, webhook_token)
     VALUES ($1, 'stripe', 'connected', 'acct_pending_refund', $2)`,
    [orgId, WEBHOOK_TOKEN],
  );
  return orgId;
}

async function seedOtherOrg(pool: Pool): Promise<void> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
    [OTHER_ORG.name, OTHER_ORG.slug],
  );
  await pool.query(
    `INSERT INTO payment_settings (organization_id, provider, status, account_id, webhook_token)
     VALUES ($1, 'stripe', 'connected', 'acct_pending_refund_other', $2)`,
    [Number(res.rows[0].id), OTHER_WEBHOOK_TOKEN],
  );
}

async function cleanup(pool: Pool): Promise<void> {
  const org = `SELECT id FROM organizations WHERE slug = $1`;
  for (const table of [
    'audit_events',
    'refunds',
    'payments',
    'seat_assignments',
    'tickets',
    'order_items',
    'orders',
    'attendees',
  ]) {
    await pool.query(`DELETE FROM ${table} WHERE organization_id IN (${org})`, [
      ORG.slug,
    ]);
  }
  await pool.query(
    `DELETE FROM webhook_events WHERE provider_event_id LIKE $1`,
    [`${EVENT_PREFIX}%`],
  );
  await pool.query(`DELETE FROM organizations WHERE slug IN ($1, $2)`, [
    ORG.slug,
    OTHER_ORG.slug,
  ]);
}
