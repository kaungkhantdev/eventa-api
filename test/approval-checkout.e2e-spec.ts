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
import { listenOnLoopback } from './support/loopback';
import {
  PENDING_REFUND_PREFIX,
  StubPaymentProvider,
} from './support/stub-payment.provider';

const PASSWORD = 'correct horse battery staple';
const ORG = { slug: 'approval-e2e', name: 'Approval E2E' };
const ADMIN = 'admin@approval-e2e.test';
const ORGANIZER = 'organizer@approval-e2e.test';
/** Deciding a PAID registration refunds it, which is Finance's privilege. */
const ADMIN_GRANTS = [
  'finView',
  'finRefund',
  'regView',
  'regManage',
  'evCreate',
];
const ORGANIZER_GRANTS = ['regView', 'regManage'];
const PERMISSION_GROUP: Record<string, string> = {
  finView: 'Finance',
  finRefund: 'Finance',
  regView: 'Registrations',
  regManage: 'Registrations',
  evCreate: 'Events',
};
/** The stub provider's signing secret (see test/support/stub-payment.provider). */
const WEBHOOK_SECRET = 'whsec_fake';
const WEBHOOK_TOKEN = 'tok-appre2e';
const WEBHOOK_EVENT_PREFIX = 'evt-appre2e-';
const BAHT = 100;
const PRICE = 1_000 * BAHT;
const DECISION_YEAR = 9999;
/** How long a case waits for a request to reach a lock, and how often it looks. */
const LOCK_WAIT_TIMEOUT_MS = 5_000;
const LOCK_POLL_MS = 20;

interface Success<T> {
  data: T;
}
interface Failure {
  message: string;
}
interface Placed {
  orderId: string;
  status: string;
  paymentStatus: string;
  paymentRequired: boolean;
  awaitingApproval: boolean;
  tickets: unknown[];
}
interface GuestOrder {
  status: string;
  awaitingApproval: boolean;
  paymentRequired: boolean;
  holdExpiresAt: string | null;
}
interface Decision {
  outcome: string;
  ticketCount: number;
}
interface OrderState {
  status: string;
  payment_status: string;
  requires_approval: boolean;
  approval_requested_at: Date | null;
}

/**
 * Require approval, pay first (US-REG-02), through the real HTTP surface and
 * the real schema: the checkout, the payment webhook, the organizer's decision
 * and Finance's refund.
 *
 * The invariants every case checks against the rows themselves:
 *   · a waiting registration's places are counted in `sold` — nobody else can
 *     take them — and it has no ticket;
 *   · approving counts nothing twice and sends the one confirmation;
 *   · rejecting gives the places back and, if money was taken, refunds it —
 *     `sold` ends where it started.
 */
describe('Require approval, pay first (e2e — US-REG-02)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let orgId: number;
  let adminJwt: string;
  let organizerJwt: string;
  let seq = 0;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    orgId = await seedOrg(pool);

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

    adminJwt = await token(ADMIN);
    organizerJwt = await token(ORGANIZER);
  }, 30000);

  afterEach(async () => {
    await clearOrders(pool, orgId);
  });

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  async function token(email: string): Promise<string> {
    const res = await request(server).post('/api/v1/auth/login').send({
      email,
      password: PASSWORD,
      orgSlug: ORG.slug,
      persona: 'admin',
    });
    return (res.body as Success<{ accessToken: string }>).data.accessToken;
  }

  interface Listed {
    eventId: string;
    slug: string;
    tierId: string;
    seatIds: number[];
  }

  /** A published event that requires approval, with one ticket type. */
  async function approvalEvent(
    o: {
      total?: number;
      price?: number;
      seating?: 'ga' | 'reserved';
      requiresApproval?: boolean;
    } = {},
  ): Promise<Listed> {
    seq += 1;
    const slug = `approval-${seq}`;
    const seating = o.seating ?? 'ga';
    const event = await pool.query<{ id: string }>(
      `INSERT INTO events (organization_id, slug, name, type, bucket, status, visibility,
                           start_at, timezone, organizer_name, published_at,
                           seating_mode, requires_approval)
       VALUES ($1, $2, 'Approval Summit', 'Conference', 'active', 'upcoming', 'public',
               now() + interval '30 days', 'Asia/Bangkok', 'Acme', now(), $3, $4)
       RETURNING id`,
      [orgId, slug, seating, o.requiresApproval ?? true],
    );
    const eventId = event.rows[0].id;
    const total = o.total ?? 1;
    const tier = await pool.query<{ id: string }>(
      `INSERT INTO ticket_types (organization_id, event_id, name, price_satang,
                                 status, total, sold, min_per_order, max_per_order)
       VALUES ($1, $2, 'General', $3, 'onsale', $4, 0, 1, 8) RETURNING id`,
      [orgId, eventId, o.price ?? 0, total],
    );
    const tierId = tier.rows[0].id;
    const seatIds =
      seating === 'reserved' ? await seatMap(eventId, tierId, total) : [];
    return { eventId, slug, tierId, seatIds };
  }

  async function seatMap(
    eventId: string,
    tierId: string,
    count: number,
  ): Promise<number[]> {
    const map = await pool.query<{ id: string }>(
      `INSERT INTO seat_maps (organization_id, event_id, name, total_seats)
       VALUES ($1, $2, 'Hall', $3) RETURNING id`,
      [orgId, eventId, count],
    );
    const ids: number[] = [];
    for (let n = 1; n <= count; n += 1) {
      const seat = await pool.query<{ id: string }>(
        `INSERT INTO seats (organization_id, seat_map_id, seat_number, status, ticket_type_id)
         VALUES ($1, $2, $3, 'available', $4) RETURNING id`,
        [orgId, map.rows[0].id, String(n), tierId],
      );
      ids.push(Number(seat.rows[0].id));
    }
    return ids;
  }

  /** What a buyer picks: a quantity, or the event's seats. */
  const pick = (listed: Listed, quantity = 1) =>
    listed.seatIds.length > 0
      ? { seatIds: listed.seatIds.slice(0, quantity) }
      : { quantity };

  const hold = (listed: Listed, quantity = 1) =>
    request(server)
      .post('/api/v1/public/checkout/hold')
      .send({
        eventId: listed.eventId,
        ticketTypeId: listed.tierId,
        ...pick(listed, quantity),
      });

  /** Hold, then confirm — the way a buyer does it. */
  async function buy(listed: Listed, email = 'anan@approval.test') {
    const held = await hold(listed);
    expect(held.status).toBe(201);
    const holdIds = (held.body as Success<{ holdIds: number[] }>).data.holdIds;
    seq += 1;
    const placed = await request(server)
      .post('/api/v1/public/checkout/confirm')
      .send({
        eventId: listed.eventId,
        ticketTypeId: listed.tierId,
        ...pick(listed),
        holdIds,
        buyer: { name: 'Anan Suksawat', email },
        idempotencyKey: `appr-order-${seq}-${ORG.slug}`,
      });
    expect(placed.status).toBe(201);
    return { ...(placed.body as Success<Placed>).data, holdIds };
  }

  /** Start one payment attempt; its id lets a case call back for THAT attempt. */
  async function pay(
    orderId: string,
    method: 'Card' | 'PromptPay' = 'Card',
  ): Promise<string> {
    seq += 1;
    const res = await request(server)
      .post('/api/v1/public/payments')
      .send({ orderId, method, idempotencyKey: `appr-pay-${seq}` });
    expect(res.status).toBe(201);
    return (res.body as Success<{ paymentId: string }>).data.paymentId;
  }

  /** A signed provider callback, the way the stub provider reads one. */
  async function webhook(body: Record<string, unknown>): Promise<void> {
    seq += 1;
    const raw = JSON.stringify({
      eventId: `${WEBHOOK_EVENT_PREFIX}${seq}`,
      ...body,
    });
    const signature = createHmac('sha256', WEBHOOK_SECRET)
      .update(raw)
      .digest('hex');
    const res = await request(server)
      .post(`/api/v1/public/payments/webhook/${WEBHOOK_TOKEN}`)
      .set('stripe-signature', signature)
      .set('content-type', 'application/json')
      .send(raw);
    expect(res.status).toBe(200);
  }

  /** The provider's signed "the money arrived" for the order's latest attempt. */
  async function settle(orderId: string) {
    const { rows } = await pool.query<{
      gateway_ref: string;
      amount_satang: string;
    }>(
      `SELECT gateway_ref, amount_satang FROM payments WHERE order_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [orderId],
    );
    await webhook({
      type: 'succeeded',
      gatewayRef: rows[0].gateway_ref,
      amountSatang: Number(rows[0].amount_satang),
    });
  }

  /**
   * The provider's signed callback about ONE attempt. A buyer who opened a
   * PromptPay QR and then paid by card has two, and each reports on its own.
   */
  async function callback(
    paymentId: string,
    type: 'succeeded' | 'expired',
  ): Promise<void> {
    const { rows } = await pool.query<{
      gateway_ref: string;
      amount_satang: string;
    }>(`SELECT gateway_ref, amount_satang FROM payments WHERE id = $1`, [
      paymentId,
    ]);
    await webhook({
      type,
      gatewayRef: rows[0].gateway_ref,
      amountSatang: Number(rows[0].amount_satang),
    });
  }

  /**
   * Wait until the connection `blockerPid` holds a lock somebody else is
   * queued on — the moment a request has done its reads and stopped at a lock.
   */
  async function someoneWaitsOn(blockerPid: number): Promise<void> {
    const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const { rows } = await pool.query(
        `SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))`,
        [blockerPid],
      );
      if (rows.length > 0) return;
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
    throw new Error('Nothing queued on the lock in time.');
  }

  /** Buy on a paid approval event and pay: the registration now waits. */
  async function paidAndWaiting(listed: Listed): Promise<string> {
    const { orderId } = await buy(listed);
    await pay(orderId);
    await settle(orderId);
    return orderId;
  }

  const approve = (jwt: string, id: string) =>
    request(server)
      .post(`/api/v1/registrations/${id}/approve`)
      .set('Authorization', `Bearer ${jwt}`)
      .send();

  const reject = (jwt: string, id: string) =>
    request(server)
      .post(`/api/v1/registrations/${id}/reject`)
      .set('Authorization', `Bearer ${jwt}`)
      .send({ confirm: true, reason: 'Not a member' });

  const guestView = async (orderId: string): Promise<GuestOrder> =>
    (
      (await request(server).get(`/api/v1/public/orders/${orderId}`))
        .body as Success<GuestOrder>
    ).data;

  const orderRow = async (orderId: string): Promise<OrderState> =>
    (
      await pool.query<OrderState>(
        `SELECT status, payment_status, requires_approval, approval_requested_at
         FROM orders WHERE id = $1`,
        [orderId],
      )
    ).rows[0];

  const soldOf = async (tierId: string): Promise<number> =>
    (
      await pool.query<{ sold: number }>(
        `SELECT sold FROM ticket_types WHERE id = $1`,
        [tierId],
      )
    ).rows[0].sold;

  const ticketCount = async (orderId: string): Promise<number> =>
    Number(
      (
        await pool.query<{ n: string }>(
          `SELECT count(*) AS n FROM tickets WHERE order_id = $1`,
          [orderId],
        )
      ).rows[0].n,
    );

  const holdsFor = async (holdIds: number[]) =>
    (
      await pool.query<{ status: string; expires_at: Date }>(
        `SELECT status, expires_at FROM seat_holds WHERE id = ANY($1) ORDER BY id`,
        [holdIds],
      )
    ).rows;

  const outboxKeys = async (orderId: string): Promise<string[]> =>
    (
      await pool.query<{ routing_key: string }>(
        `SELECT routing_key FROM outbox_events WHERE aggregate_id = $1 ORDER BY id`,
        [orderId],
      )
    ).rows.map((r) => r.routing_key);

  const confirmedPayloads = async (orderId: string) =>
    (
      await pool.query<{ payload: { paid: boolean; ticketCount: number } }>(
        `SELECT payload FROM outbox_events
         WHERE aggregate_id = $1 AND routing_key = 'registration.confirmed'`,
        [orderId],
      )
    ).rows.map((r) => r.payload);

  const refundsOf = async (orderId: string) =>
    (
      await pool.query<{ status: string; idempotency_key: string }>(
        `SELECT status, idempotency_key FROM refunds WHERE order_id = $1`,
        [orderId],
      )
    ).rows;

  const paymentStatusesOf = async (orderId: string): Promise<string[]> =>
    (
      await pool.query<{ status: string }>(
        `SELECT status FROM payments WHERE order_id = $1 ORDER BY created_at, id`,
        [orderId],
      )
    ).rows.map((r) => r.status);

  const refundNotices = async (orderId: string) =>
    (
      await pool.query<{ payload: { amountSatang: number; reason: string } }>(
        `SELECT payload FROM outbox_events
         WHERE aggregate_id = $1 AND routing_key = 'payment.refund_required'
         ORDER BY id`,
        [orderId],
      )
    ).rows.map((r) => r.payload);

  describe('a free registration', () => {
    it('waits for the organizer holding its place — no ticket, no confirmation', async () => {
      const listed = await approvalEvent({ total: 2 });
      const placed = await buy(listed);

      expect(placed.status).toBe('pending');
      expect(placed.awaitingApproval).toBe(true);
      expect(placed.paymentRequired).toBe(false);
      expect(placed.tickets).toEqual([]);
      const row = await orderRow(placed.orderId);
      expect(row.requires_approval).toBe(true);
      expect(row.approval_requested_at).not.toBeNull();
      expect(await ticketCount(placed.orderId)).toBe(0);
      expect(await soldOf(listed.tierId)).toBe(1);
      // Counted in `sold`, so the hold has nothing left to reserve.
      expect((await holdsFor(placed.holdIds))[0].status).toBe('converted');
      expect(await outboxKeys(placed.orderId)).toEqual([]);

      const view = await guestView(placed.orderId);
      expect(view.awaitingApproval).toBe(true);
      expect(view.paymentRequired).toBe(false);
      expect(view.holdExpiresAt).toBeNull();
    });

    it('keeps its place from everyone else while it waits', async () => {
      const listed = await approvalEvent({ total: 1 });
      await buy(listed);
      expect((await hold(listed)).status).toBe(409);
    });

    it('approving the last place issues the ticket and the one confirmation, counting it once', async () => {
      const listed = await approvalEvent({ total: 1 });
      const { orderId } = await buy(listed);

      const res = await approve(organizerJwt, orderId);

      expect(res.status).toBe(201);
      expect((res.body as Success<Decision>).data.outcome).toBe('approved');
      expect((await orderRow(orderId)).status).toBe('confirmed');
      expect(await ticketCount(orderId)).toBe(1);
      expect(await soldOf(listed.tierId)).toBe(1);
      expect(await confirmedPayloads(orderId)).toEqual([
        expect.objectContaining({ paid: false, ticketCount: 1 }),
      ]);

      const again = await approve(organizerJwt, orderId);
      expect((again.body as Success<Decision>).data.outcome).toBe(
        'already_approved',
      );
      expect(await ticketCount(orderId)).toBe(1);
      expect(await outboxKeys(orderId)).toEqual(['registration.confirmed']);
    });

    it('rejecting gives the place back, refunds nothing, and queues the notice', async () => {
      const listed = await approvalEvent({ total: 1 });
      const { orderId } = await buy(listed);

      const res = await reject(organizerJwt, orderId);

      expect(res.status).toBe(201);
      expect((await orderRow(orderId)).status).toBe('rejected');
      expect(await soldOf(listed.tierId)).toBe(0);
      expect(await outboxKeys(orderId)).toEqual(['registration.rejected']);
      expect(await refundsOf(orderId)).toEqual([]);
      expect((await hold(listed)).status).toBe(201);
    });

    it('is never held for approval when the organizer enters it by hand (US-REG-03)', async () => {
      const listed = await approvalEvent({ total: 2 });
      const res = await request(server)
        .post('/api/v1/registrations')
        .set('Authorization', `Bearer ${adminJwt}`)
        .send({
          eventId: listed.eventId,
          ticketTypeId: listed.tierId,
          quantity: 1,
          name: 'Malee',
          email: 'malee@approval.test',
        });
      expect(res.status).toBe(201);
      const added = (res.body as Success<{ orderId: string; status: string }>)
        .data;
      expect(added.status).toBe('confirmed');
      expect(await ticketCount(added.orderId)).toBe(1);
    });
  });

  describe('a paid registration pays first', () => {
    it('is placed for payment, and starts waiting only when the money lands', async () => {
      const listed = await approvalEvent({ total: 1, price: PRICE });
      const placed = await buy(listed);
      expect(placed.status).toBe('pending');
      expect(placed.awaitingApproval).toBe(false);
      expect(placed.paymentRequired).toBe(true);
      expect(await soldOf(listed.tierId)).toBe(0);
      expect((await holdsFor(placed.holdIds))[0].status).toBe('active');

      await pay(placed.orderId);
      await settle(placed.orderId);

      const row = await orderRow(placed.orderId);
      expect(row.status).toBe('pending');
      expect(row.payment_status).toBe('paid');
      expect(row.approval_requested_at).not.toBeNull();
      expect(await soldOf(listed.tierId)).toBe(1);
      expect(await ticketCount(placed.orderId)).toBe(0);
      expect(await paymentStatusesOf(placed.orderId)).toEqual(['paid']);
      // The receipt and the ticket go together, on approval — not now.
      expect(await outboxKeys(placed.orderId)).toEqual([]);

      const view = await guestView(placed.orderId);
      expect(view.awaitingApproval).toBe(true);
      expect(view.paymentRequired).toBe(false);
      expect(view.holdExpiresAt).toBeNull();
    });

    it('follows the rule the buyer was told, even if the organizer flips it mid-payment', async () => {
      const listed = await approvalEvent({ total: 1, price: PRICE });
      const { orderId } = await buy(listed);
      await pool.query(
        `UPDATE events SET requires_approval = false WHERE id = $1`,
        [listed.eventId],
      );
      await pay(orderId);
      await settle(orderId);
      expect((await orderRow(orderId)).status).toBe('pending');
      expect(await ticketCount(orderId)).toBe(0);
    });

    it('keeps its place from everyone else while it waits', async () => {
      const listed = await approvalEvent({ total: 1, price: PRICE });
      await paidAndWaiting(listed);

      expect((await hold(listed)).status).toBe(409);
      const view = await request(server).get(
        `/api/v1/public/checkout/${listed.slug}`,
      );
      const opened = (
        view.body as Success<{
          tiers: { remaining: number; status: string }[];
          notes: { approval: string | null };
        }>
      ).data;
      const [tier] = opened.tiers;
      expect(tier.remaining).toBe(0);
      expect(tier.status).toBe('soldout');
      // Said at checkout, before anybody pays.
      expect(opened.notes.approval).toMatch(/refunded in full/i);
    });

    it('a second success callback changes nothing', async () => {
      const listed = await approvalEvent({ total: 1, price: PRICE });
      const orderId = await paidAndWaiting(listed);
      await settle(orderId);
      expect((await orderRow(orderId)).status).toBe('pending');
      expect(await soldOf(listed.tierId)).toBe(1);
      expect(await ticketCount(orderId)).toBe(0);
    });

    it('a second PAYMENT while it waits is refunded as a duplicate, and counts nothing twice', async () => {
      // The buyer opened a PromptPay QR, then paid by card — and the bank app
      // scanned the old QR anyway. Both attempts were started before either
      // settled, so both are live.
      const listed = await approvalEvent({ total: 1, price: PRICE });
      const { orderId } = await buy(listed);
      const first = await pay(orderId, 'PromptPay');
      const second = await pay(orderId);

      await callback(first, 'succeeded');
      await callback(second, 'succeeded');

      expect(await orderRow(orderId)).toMatchObject({
        status: 'pending',
        payment_status: 'paid',
      });
      expect(await soldOf(listed.tierId)).toBe(1);
      expect(await paymentStatusesOf(orderId)).toEqual(['paid', 'paid']);
      const { rows } = await pool.query<{ amount_satang: string }>(
        `SELECT amount_satang FROM payments WHERE id = $1`,
        [second],
      );
      expect(await refundNotices(orderId)).toEqual([
        expect.objectContaining({
          amountSatang: Number(rows[0].amount_satang),
          reason: 'duplicate_payment',
        }),
      ]);

      expect((await approve(organizerJwt, orderId)).status).toBe(201);
      expect(await ticketCount(orderId)).toBe(1);
      expect(await soldOf(listed.tierId)).toBe(1);
      expect(await confirmedPayloads(orderId)).toHaveLength(1);
    });

    it('rejecting a registration that was paid for twice refunds BOTH payments', async () => {
      const listed = await approvalEvent({ total: 1, price: PRICE });
      const { orderId } = await buy(listed);
      const first = await pay(orderId, 'PromptPay');
      const second = await pay(orderId);
      await callback(first, 'succeeded');
      await callback(second, 'succeeded');

      const res = await reject(adminJwt, orderId);

      expect(res.status).toBe(201);
      expect(await orderRow(orderId)).toMatchObject({
        status: 'rejected',
        payment_status: 'refunded',
      });
      expect(await paymentStatusesOf(orderId)).toEqual([
        'refunded',
        'refunded',
      ]);
      const keys = (await refundsOf(orderId))
        .map((r) => `${r.status} ${r.idempotency_key}`)
        .sort();
      expect(keys).toEqual(
        [
          `succeeded registration-rejected:${orderId}:${first}`,
          `succeeded registration-rejected:${orderId}:${second}`,
        ].sort(),
      );
      expect(await soldOf(listed.tierId)).toBe(0);

      // A retry finds both refunds made, and makes no third.
      expect((await reject(adminJwt, orderId)).status).toBe(201);
      expect(await refundsOf(orderId)).toHaveLength(2);
    });

    it('a place given back while a payment waits for the tier is not counted back in', async () => {
      // Two places. One registration is paid and waiting; a second buyer's
      // payment lands. The settlement reads the tier, then waits for its lock
      // — and in that gap the first registration's place goes back (the
      // `locker` below stands in for a rejection committing there).
      const listed = await approvalEvent({ total: 2, price: PRICE });
      await paidAndWaiting(listed);
      const { orderId } = await buy(listed, 'malee@approval.test');
      const paymentId = await pay(orderId);
      const locker = await pool.connect();
      try {
        await locker.query('BEGIN');
        const { rows } = await locker.query<{ pid: number }>(
          `SELECT pg_backend_pid() AS pid`,
        );
        await locker.query(
          `SELECT id FROM ticket_types WHERE id = $1 FOR UPDATE`,
          [listed.tierId],
        );
        const settling = callback(paymentId, 'succeeded');
        await someoneWaitsOn(rows[0].pid);
        await locker.query(
          `UPDATE ticket_types SET sold = GREATEST(sold - 1, 0) WHERE id = $1`,
          [listed.tierId],
        );
        await locker.query('COMMIT');
        await settling;
      } finally {
        locker.release();
      }

      expect((await orderRow(orderId)).payment_status).toBe('paid');
      // Only the second registration holds a place now.
      expect(await soldOf(listed.tierId)).toBe(1);
    });

    it('approving at full capacity issues the tickets and the paid confirmation once', async () => {
      const listed = await approvalEvent({ total: 1, price: PRICE });
      const orderId = await paidAndWaiting(listed);

      const res = await approve(organizerJwt, orderId);

      expect(res.status).toBe(201);
      expect(await orderRow(orderId)).toMatchObject({
        status: 'confirmed',
        payment_status: 'paid',
      });
      expect(await ticketCount(orderId)).toBe(1);
      expect(await soldOf(listed.tierId)).toBe(1);
      expect(await confirmedPayloads(orderId)).toEqual([
        expect.objectContaining({ paid: true, ticketCount: 1 }),
      ]);
    });

    it('rejecting refunds the payment and gives the place back', async () => {
      const listed = await approvalEvent({ total: 1, price: PRICE });
      const { orderId } = await buy(listed);
      const paymentId = await pay(orderId);
      await callback(paymentId, 'succeeded');

      const res = await reject(adminJwt, orderId);

      expect(res.status).toBe(201);
      expect(await orderRow(orderId)).toMatchObject({
        status: 'rejected',
        payment_status: 'refunded',
      });
      expect(await refundsOf(orderId)).toEqual([
        {
          status: 'succeeded',
          idempotency_key: `registration-rejected:${orderId}:${paymentId}`,
        },
      ]);
      expect(await paymentStatusesOf(orderId)).toEqual(['refunded']);
      expect(await soldOf(listed.tierId)).toBe(0);
      expect(await outboxKeys(orderId)).toEqual(['registration.rejected']);

      const again = await reject(adminJwt, orderId);
      expect(again.status).toBe(201);
      expect(await refundsOf(orderId)).toHaveLength(1);
      expect(await soldOf(listed.tierId)).toBe(0);
      expect(await outboxKeys(orderId)).toEqual(['registration.rejected']);
    });

    it('a refund the provider settles later keeps the registration rejected, and gives nothing back twice', async () => {
      // PromptPay: Stripe must collect the buyer's bank details first.
      const listed = await approvalEvent({ total: 1, price: PRICE });
      const orderId = await paidAndWaiting(listed);
      await pool.query(
        `UPDATE payments SET gateway_ref = $2 WHERE order_id = $1`,
        [orderId, `${PENDING_REFUND_PREFIX}${orderId}`],
      );

      expect((await reject(adminJwt, orderId)).status).toBe(201);

      expect(await orderRow(orderId)).toMatchObject({
        status: 'rejected',
        payment_status: 'paid',
      });
      expect(await soldOf(listed.tierId)).toBe(0);
      const [pending] = await refundsOf(orderId);
      expect(pending.status).toBe('pending');

      const { rows } = await pool.query<{
        gateway_ref: string;
        amount_satang: string;
      }>(`SELECT gateway_ref, amount_satang FROM refunds WHERE order_id = $1`, [
        orderId,
      ]);
      await webhook({
        type: 'refund_succeeded',
        gatewayRef: rows[0].gateway_ref,
        amountSatang: Number(rows[0].amount_satang),
        declineReason: null,
      });

      expect(await orderRow(orderId)).toMatchObject({
        status: 'rejected',
        payment_status: 'refunded',
      });
      expect(await soldOf(listed.tierId)).toBe(0);
    });

    it('refuses the rejection to someone who may not refund — and changes nothing', async () => {
      const listed = await approvalEvent({ total: 1, price: PRICE });
      const orderId = await paidAndWaiting(listed);

      const res = await reject(organizerJwt, orderId);

      expect(res.status).toBe(403);
      expect((res.body as Failure).message).toMatch(/refund/i);
      expect(await orderRow(orderId)).toMatchObject({
        status: 'pending',
        payment_status: 'paid',
      });
      expect(await soldOf(listed.tierId)).toBe(1);
      expect(await refundsOf(orderId)).toEqual([]);
    });

    it('a Finance refund of a waiting registration cancels it and gives the place back', async () => {
      const listed = await approvalEvent({ total: 1, price: PRICE });
      const orderId = await paidAndWaiting(listed);
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM payments WHERE order_id = $1`,
        [orderId],
      );

      const res = await request(server)
        .post(`/api/v1/payments/${rows[0].id}/refund`)
        .set('Authorization', `Bearer ${adminJwt}`)
        .send({ idempotencyKey: `appr-refund-${orderId}` });

      expect(res.status).toBe(200);
      expect(await orderRow(orderId)).toMatchObject({
        status: 'cancelled',
        payment_status: 'refunded',
      });
      expect(await soldOf(listed.tierId)).toBe(0);
    });
  });

  describe('reserved seating', () => {
    it('keeps the paid seat held until the decision, and approving seats the attendee', async () => {
      const listed = await approvalEvent({
        total: 1,
        price: PRICE,
        seating: 'reserved',
      });
      const { orderId, holdIds } = await buy(listed);
      await pay(orderId);
      await settle(orderId);

      const [held] = await holdsFor(holdIds);
      expect(held.status).toBe('active');
      expect(held.expires_at.getUTCFullYear()).toBe(DECISION_YEAR);
      expect(await soldOf(listed.tierId)).toBe(1);
      const view = await request(server).get(
        `/api/v1/public/checkout/${listed.slug}`,
      );
      const seats = (
        view.body as Success<{ seatMap: { seats: { available: boolean }[] } }>
      ).data.seatMap.seats;
      expect(seats.every((s) => !s.available)).toBe(true);

      expect((await approve(organizerJwt, orderId)).status).toBe(201);

      const { rows } = await pool.query<{ seat_id: string }>(
        `SELECT a.seat_id FROM seat_assignments a
         JOIN tickets t ON t.id = a.ticket_id WHERE t.order_id = $1`,
        [orderId],
      );
      expect(rows.map((r) => Number(r.seat_id))).toEqual(listed.seatIds);
      expect(await soldOf(listed.tierId)).toBe(1);
    });

    it('a free seat waits held until the decision, then is assigned on approval', async () => {
      const listed = await approvalEvent({ total: 1, seating: 'reserved' });
      const { orderId, holdIds } = await buy(listed);

      const [held] = await holdsFor(holdIds);
      expect(held.status).toBe('active');
      expect(held.expires_at.getUTCFullYear()).toBe(DECISION_YEAR);
      expect(await soldOf(listed.tierId)).toBe(1);

      expect((await approve(organizerJwt, orderId)).status).toBe(201);
      expect(await ticketCount(orderId)).toBe(1);
      expect(await soldOf(listed.tierId)).toBe(1);
      expect((await holdsFor(holdIds))[0].status).toBe('converted');
    });

    it('rejecting frees the seat for somebody else', async () => {
      const listed = await approvalEvent({
        total: 1,
        price: PRICE,
        seating: 'reserved',
      });
      const orderId = await paidAndWaiting(listed);

      expect((await reject(adminJwt, orderId)).status).toBe(201);

      expect(await soldOf(listed.tierId)).toBe(0);
      expect((await hold(listed)).status).toBe(201);
    });

    it('refunds a payment that lands after its seat was released, instead of waiting on a seat it lost', async () => {
      const listed = await approvalEvent({
        total: 1,
        price: PRICE,
        seating: 'reserved',
      });
      const { orderId, holdIds } = await buy(listed);
      await pay(orderId);
      await pool.query(
        `UPDATE seat_holds SET status = 'released' WHERE id = ANY($1)`,
        [holdIds],
      );

      await settle(orderId);

      expect((await orderRow(orderId)).status).toBe('cancelled');
      expect(await outboxKeys(orderId)).toEqual(['payment.refund_required']);
      // A code the worker words for the buyer in their language — never an
      // English sentence dropped into a Thai email.
      expect(await refundNotices(orderId)).toEqual([
        expect.objectContaining({ reason: 'seats_released' }),
      ]);
      expect(await soldOf(listed.tierId)).toBe(0);
    });

    it('an abandoned attempt lapsing AFTER the payment keeps the seat for the decision', async () => {
      // A PromptPay QR opened first, then the card paid. The QR's expiry
      // arrives later — about an attempt, not about the order, which is paid.
      const listed = await approvalEvent({
        total: 1,
        price: PRICE,
        seating: 'reserved',
      });
      const { orderId, holdIds } = await buy(listed);
      const abandoned = await pay(orderId, 'PromptPay');
      const paid = await pay(orderId);
      await callback(paid, 'succeeded');

      await callback(abandoned, 'expired');

      const [held] = await holdsFor(holdIds);
      expect(held.status).toBe('active');
      expect(held.expires_at.getUTCFullYear()).toBe(DECISION_YEAR);
      expect((await hold(listed)).status).toBe(409);

      expect((await approve(organizerJwt, orderId)).status).toBe(201);
      const { rows } = await pool.query<{ seat_id: string }>(
        `SELECT a.seat_id FROM seat_assignments a
         JOIN tickets t ON t.id = a.ticket_id WHERE t.order_id = $1`,
        [orderId],
      );
      expect(rows.map((r) => Number(r.seat_id))).toEqual(listed.seatIds);
    });

    it('an attempt lapsing while the order is still unpaid releases its seat, as before', async () => {
      const listed = await approvalEvent({
        total: 1,
        price: PRICE,
        seating: 'reserved',
      });
      const { orderId, holdIds } = await buy(listed);
      const lapsed = await pay(orderId, 'PromptPay');

      await callback(lapsed, 'expired');

      expect((await holdsFor(holdIds))[0].status).toBe('released');
    });

    it('an anonymous release cannot free a seat an order is holding', async () => {
      const listed = await approvalEvent({
        total: 1,
        price: PRICE,
        seating: 'reserved',
      });
      const { orderId, holdIds } = await buy(listed);
      await pay(orderId);
      await settle(orderId);

      const res = await request(server)
        .delete('/api/v1/public/checkout/hold')
        .send({ eventId: listed.eventId, holdIds });

      expect(res.status).toBe(204);
      expect((await holdsFor(holdIds))[0].status).toBe('active');
    });
  });

  it('an organizer switches the rule on for an event (US-REG-02)', async () => {
    const listed = await approvalEvent({ requiresApproval: false });
    const res = await request(server)
      .patch(`/api/v1/events/${listed.eventId}`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ requiresApproval: true });
    expect(res.status).toBe(200);
    expect(
      (res.body as Success<{ requiresApproval: boolean }>).data
        .requiresApproval,
    ).toBe(true);
  });
});

async function seedOrg(pool: Pool): Promise<number> {
  const org = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug, vat_rate, service_fee_rate)
     VALUES ($1, $2, 0.0700, 0.0500) RETURNING id`,
    [ORG.name, ORG.slug],
  );
  const orgId = Number(org.rows[0].id);
  const passwordHash = await hash(PASSWORD);
  for (const [email, roleName, grants] of [
    [ADMIN, 'Admin', ADMIN_GRANTS],
    [ORGANIZER, 'Organizer', ORGANIZER_GRANTS],
  ] as const) {
    const role = await pool.query<{ id: string }>(
      `INSERT INTO roles (organization_id, name, description) VALUES ($1, $2, 'seed') RETURNING id`,
      [orgId, roleName],
    );
    for (const key of grants) {
      await pool.query(
        `INSERT INTO permissions (key, "group", label) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO NOTHING`,
        [key, PERMISSION_GROUP[key], key],
      );
      await pool.query(
        `INSERT INTO role_permissions (role_id, permission_key, granted) VALUES ($1, $2, true)`,
        [role.rows[0].id, key],
      );
    }
    const user = await pool.query<{ id: string }>(
      `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
       VALUES ($1, 'Seed', $2, 'admin', 'Active', $3) RETURNING id`,
      [orgId, email, passwordHash],
    );
    await pool.query(
      `INSERT INTO memberships (organization_id, user_id, role_id, role, status)
       VALUES ($1, $2, $3, $4, 'Active')`,
      [orgId, user.rows[0].id, role.rows[0].id, roleName],
    );
  }
  // A workspace takes (and refunds) money only on its own connected account.
  await pool.query(
    `INSERT INTO payment_settings (organization_id, provider, status, account_id, webhook_token)
     VALUES ($1, 'stripe', 'connected', 'acct_appre2e', $2)`,
    [orgId, WEBHOOK_TOKEN],
  );
  return orgId;
}

/** Everything a case wrote, children before parents. */
const ORDER_TABLES = [
  'refunds',
  'payments',
  'seat_assignments',
  'seat_holds',
  'tickets',
  'discount_redemptions',
  'order_items',
  'orders',
  'outbox_events',
  'seats',
  'seat_maps',
  'ticket_types',
  'events',
  'audit_events',
];

async function clearOrders(pool: Pool, orgId: number): Promise<void> {
  for (const table of ORDER_TABLES) {
    await pool.query(`DELETE FROM ${table} WHERE organization_id = $1`, [
      orgId,
    ]);
  }
  await pool.query(
    `DELETE FROM webhook_events WHERE provider_event_id LIKE $1`,
    [`${WEBHOOK_EVENT_PREFIX}%`],
  );
}

async function cleanup(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM organizations WHERE slug = $1`,
    [ORG.slug],
  );
  for (const { id } of rows) await clearOrders(pool, Number(id));
  await pool.query(`DELETE FROM organizations WHERE slug = $1`, [ORG.slug]);
}
