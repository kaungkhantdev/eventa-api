process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://eventa:eventa@localhost:5432/eventa';
process.env.JWT_SECRET ??= 'test-secret-at-least-16-characters-long';

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
import { StubPaymentProvider } from './support/stub-payment.provider';

const PASSWORD = 'correct horse battery staple';
const ORG = { slug: 'refund-stock-e2e', name: 'Refund Stock E2E' };
const ADMIN = 'admin@refund-stock-e2e.test';
const GRANTS = ['finView', 'finRefund', 'regView', 'regManage'];
const PRICE = 100_000;

interface Success<T> {
  data: T;
}

/**
 * A refund gives the place back (US-FIN-02), against the real schema and the
 * whole module graph.
 *
 * `ticket_types.sold` only ever went UP: a refund voided the tickets and
 * released reserved seats, but the ticket type still counted them as sold. A
 * sold-out ticket stayed sold out after every refund — checkout refused the
 * freed place, and the waitlist could never be offered it.
 */
describe('A refund returns its tickets to sale (e2e — US-FIN-02)', () => {
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

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PaymentProviderPort)
      .useClass(StubPaymentProvider)
      .compile();
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
      'refunds',
      'payments',
      'seat_assignments',
      'seat_holds',
      'tickets',
      'order_items',
      'orders',
      'outbox_events',
      'seats',
      'seat_maps',
      'ticket_types',
      'events',
    ]) {
      await pool.query(`DELETE FROM ${table} WHERE organization_id = $1`, [
        orgId,
      ]);
    }
  });

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  /** A published event with one ticket type of `total` places, all sold. */
  async function soldOutEvent(
    o: { seating?: 'ga' | 'reserved'; waitlist?: boolean; total?: number } = {},
  ) {
    seq += 1;
    const total = o.total ?? 2;
    const event = await pool.query<{ id: string }>(
      `INSERT INTO events (organization_id, slug, name, type, bucket, status, visibility,
                           start_at, timezone, organizer_name, published_at,
                           seating_mode, waitlist_enabled)
       VALUES ($1, $2, 'Refund Summit', 'Conference', 'active', 'upcoming', 'public',
               now() + interval '30 days', 'Asia/Bangkok', 'Acme', now(), $3, $4)
       RETURNING id`,
      [orgId, `refund-stock-${seq}`, o.seating ?? 'ga', o.waitlist ?? false],
    );
    const eventId = event.rows[0].id;
    const tier = await pool.query<{ id: string }>(
      `INSERT INTO ticket_types (organization_id, event_id, name, price_satang,
                                 status, total, sold, min_per_order, max_per_order)
       VALUES ($1, $2, 'General', $3, 'onsale', $4, $4, 1, 8) RETURNING id`,
      [orgId, eventId, PRICE, total],
    );
    return { eventId, tierId: tier.rows[0].id };
  }

  /** A paid, confirmed order holding `seats` live tickets on the tier. */
  async function paidOrder(
    eventId: string,
    tierId: string,
    seats: number,
  ): Promise<{ orderId: string; paymentId: string; ticketIds: string[] }> {
    seq += 1;
    const total = PRICE * seats;
    const order = await pool.query<{ id: string }>(
      `INSERT INTO orders (organization_id, reference, event_id, buyer_name, buyer_email,
                           status, payment_status, seats, subtotal_satang, total_satang)
       VALUES ($1, $2, $3, 'Anan', 'anan@refund-stock.test', 'confirmed', 'paid', $4, $5, $5)
       RETURNING id`,
      [orgId, `RFS-${seq}`, eventId, seats, total],
    );
    const orderId = order.rows[0].id;
    const item = await pool.query<{ id: string }>(
      `INSERT INTO order_items (organization_id, order_id, ticket_type_id, quantity,
                                unit_price_satang, line_subtotal_satang)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [orgId, orderId, tierId, seats, PRICE, total],
    );
    const ticketIds: string[] = [];
    for (let i = 0; i < seats; i += 1) {
      const ticket = await pool.query<{ id: string }>(
        `INSERT INTO tickets (organization_id, order_id, order_item_id, event_id,
                              ticket_type_id, qr_token, holder_name, ticket_label, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'Anan', 'General', 'issued') RETURNING id`,
        [
          orgId,
          orderId,
          item.rows[0].id,
          eventId,
          tierId,
          `RFS-QR-${seq}-${i}`,
        ],
      );
      ticketIds.push(ticket.rows[0].id);
    }
    const payment = await pool.query<{ id: string }>(
      `INSERT INTO payments (organization_id, txn, order_id, event_id, payer_name, method,
                             amount_satang, status, paid_at, gateway_ref, idempotency_key)
       VALUES ($1, $2, $3, $4, 'Anan', 'Card', $5, 'paid', now(), $6, $7)
       RETURNING id`,
      [
        orgId,
        `RFS-TXN-${seq}`,
        orderId,
        eventId,
        total,
        `fake_pi_rfs_${seq}`,
        `rfs-pay-${seq}`,
      ],
    );
    return { orderId, paymentId: payment.rows[0].id, ticketIds };
  }

  const refund = (paymentId: string) => {
    seq += 1;
    return request(server)
      .post(`/api/v1/payments/${paymentId}/refund`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ idempotencyKey: `rfs-refund-${seq}-${Date.now()}` });
  };

  const soldOf = async (tierId: string): Promise<number> =>
    (
      await pool.query<{ sold: number }>(
        `SELECT sold FROM ticket_types WHERE id = $1`,
        [tierId],
      )
    ).rows[0].sold;

  const holdQuantity = (eventId: string, tierId: string, quantity: number) =>
    request(server)
      .post('/api/v1/public/checkout/hold')
      .send({ eventId, ticketTypeId: tierId, quantity });

  describe('general admission', () => {
    it('puts a refunded order’s places back on sale', async () => {
      const { eventId, tierId } = await soldOutEvent({ total: 2 });
      const { paymentId } = await paidOrder(eventId, tierId, 2);
      expect((await holdQuantity(eventId, tierId, 1)).status).toBe(409);

      expect((await refund(paymentId)).status).toBe(200);

      expect(await soldOf(tierId)).toBe(0);
      expect((await holdQuantity(eventId, tierId, 1)).status).toBe(201);
    });

    it('gives back exactly what the order held, not the whole ticket type', async () => {
      const { eventId, tierId } = await soldOutEvent({ total: 3 });
      await paidOrder(eventId, tierId, 2);
      const { paymentId } = await paidOrder(eventId, tierId, 1);

      await refund(paymentId).expect(200);

      expect(await soldOf(tierId)).toBe(2);
    });

    it('lets the organizer offer the freed place to someone on the waitlist (US-REG-04)', async () => {
      const { eventId, tierId } = await soldOutEvent({
        total: 1,
        waitlist: true,
      });
      const { paymentId } = await paidOrder(eventId, tierId, 1);
      const joined = await request(server)
        .post('/api/v1/public/checkout/waitlist')
        .send({
          eventId,
          ticketTypeId: tierId,
          quantity: 1,
          buyer: { name: 'Malee', email: 'malee@refund-stock.test' },
          idempotencyKey: `rfs-wait-${Date.now()}`,
        })
        .expect(201);
      const entry = (joined.body as Success<{ orderId: string }>).data;

      await refund(paymentId).expect(200);

      const offered = await request(server)
        .post(`/api/v1/registrations/${entry.orderId}/offer`)
        .set('Authorization', `Bearer ${adminJwt}`)
        .send();
      expect(offered.status).toBe(201);
      expect((offered.body as Success<{ outcome: string }>).data.outcome).toBe(
        'offered',
      );
    });
  });

  describe('reserved seating', () => {
    it('frees the seat AND the ticket type, so the seat can be chosen again', async () => {
      // `sold` counts reserved seats too. Releasing the seat alone left a free
      // seat on a ticket type still reading "sold out", which refused it.
      const { eventId, tierId } = await soldOutEvent({
        seating: 'reserved',
        total: 1,
      });
      const map = await pool.query<{ id: string }>(
        `INSERT INTO seat_maps (organization_id, event_id, name, total_seats)
         VALUES ($1, $2, 'Hall', 1) RETURNING id`,
        [orgId, eventId],
      );
      const seat = await pool.query<{ id: string }>(
        `INSERT INTO seats (organization_id, seat_map_id, seat_number, status, ticket_type_id)
         VALUES ($1, $2, '1', 'available', $3) RETURNING id`,
        [orgId, map.rows[0].id, tierId],
      );
      const seatId = Number(seat.rows[0].id);
      const { paymentId, ticketIds } = await paidOrder(eventId, tierId, 1);
      await pool.query(
        `INSERT INTO seat_assignments (organization_id, seat_id, ticket_id) VALUES ($1, $2, $3)`,
        [orgId, seatId, ticketIds[0]],
      );

      await refund(paymentId).expect(200);

      expect(await soldOf(tierId)).toBe(0);
      const hold = await request(server)
        .post('/api/v1/public/checkout/hold')
        .send({ eventId, ticketTypeId: tierId, seatIds: [seatId] });
      expect(hold.status).toBe(201);
    });
  });

  describe('never more than once, never below nothing', () => {
    it('refuses a second refund, and gives nothing back twice', async () => {
      const { eventId, tierId } = await soldOutEvent({ total: 2 });
      await paidOrder(eventId, tierId, 1);
      const { paymentId } = await paidOrder(eventId, tierId, 1);

      await refund(paymentId).expect(200);
      expect((await refund(paymentId)).status).toBe(409);

      expect(await soldOf(tierId)).toBe(1);
    });

    it('stops at nought when the count had already drifted below the tickets', async () => {
      // A count lower than the live tickets is already wrong; a refund must
      // not compound it into a negative that sells places that do not exist.
      const { eventId, tierId } = await soldOutEvent({ total: 2 });
      const { paymentId } = await paidOrder(eventId, tierId, 2);
      await pool.query(`UPDATE ticket_types SET sold = 1 WHERE id = $1`, [
        tierId,
      ]);

      await refund(paymentId).expect(200);

      expect(await soldOf(tierId)).toBe(0);
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
  // Refunds reverse on the workspace's own connected account.
  await pool.query(
    `INSERT INTO payment_settings (organization_id, provider, status, account_id)
     VALUES ($1, 'stripe', 'connected', 'acct_refund_stock')`,
    [orgId],
  );
  return orgId;
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
  await pool.query(`DELETE FROM organizations WHERE slug = $1`, [ORG.slug]);
}
