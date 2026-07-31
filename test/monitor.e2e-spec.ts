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

const PASSWORD = 'correct horse battery staple';
const ORG = { slug: 'monitor-e2e', name: 'Monitor E2E' };
const FULL = 'full@monitor-e2e.test'; // evCreate + regView + finView
const NOFIN = 'nofin@monitor-e2e.test'; // evCreate + regView (no finView)
const NOREG = 'noreg@monitor-e2e.test'; // evCreate only

interface Success<T> {
  data: T;
  meta?: { page: number; limit: number; total: number };
}

describe('Event Monitor — Overview / Registrations / Attendees (US-EVT-14, e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let orgId: number;
  let eventId: string;
  let ticketTypeId: string;
  let seq = 0;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    await seed();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  const token = async (email: string): Promise<string> => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, orgSlug: ORG.slug, persona: 'admin' });
    return (res.body as Success<{ accessToken: string }>).data.accessToken;
  };

  const get = (jwt: string, path: string) =>
    request(server)
      .get(`/api/v1/events/${eventId}${path}`)
      .set('Authorization', `Bearer ${jwt}`);

  describe('Overview', () => {
    it('shows registrations, tickets sold, revenue and fill to a finance viewer', async () => {
      const jwt = await token(FULL);
      const res = await get(jwt, '/overview');
      expect(res.status).toBe(200);
      expect((res.body as Success<Record<string, unknown>>).data).toMatchObject(
        {
          registrations: 3, // seats of the two confirmed orders (2 + 1)
          ticketsSold: 3, // three issued tickets
          capacity: 100,
          fillPercent: 3,
          revenueSatang: 134000, // two paid payments (89000 + 45000)
        },
      );
      const data = (
        res.body as Success<{ publicUrl: string; daysLeft: number }>
      ).data;
      expect(data.publicUrl).toMatch(/\/e\/[a-z0-9-]+$/);
      expect(typeof data.daysLeft).toBe('number');
    });

    it('hides revenue from a caller without finView (numbers still show)', async () => {
      const jwt = await token(NOFIN);
      const res = await get(jwt, '/overview');
      expect(res.status).toBe(200);
      const data = (res.body as Success<Record<string, unknown>>).data;
      expect(data.revenueSatang).toBeNull();
      expect(data.registrations).toBe(3);
    });

    it('404s for an event outside the workspace', async () => {
      const jwt = await token(FULL);
      const res = await request(server)
        .get('/api/v1/events/00000000-0000-0000-0000-000000000000/overview')
        .set('Authorization', `Bearer ${jwt}`);
      expect(res.status).toBe(404);
    });
  });

  describe('Registrations tab', () => {
    it('lists all registrations with per-status badge counts', async () => {
      const jwt = await token(FULL);
      const res = await get(jwt, '/registrations');
      expect(res.status).toBe(200);
      const data = (
        res.body as Success<{
          items: { paymentStatus: string; tickets: number }[];
          total: number;
          statusCounts: Record<string, number>;
        }>
      ).data;
      expect(data.total).toBe(4);
      expect(data.statusCounts).toEqual({
        all: 4,
        paid: 2,
        pending: 1,
        refunded: 1,
      });
    });

    it('filters by payment status', async () => {
      const jwt = await token(FULL);
      const res = await get(jwt, '/registrations?status=paid');
      const data = (
        res.body as Success<{
          items: { paymentStatus: string }[];
          total: number;
        }>
      ).data;
      expect(data.total).toBe(2);
      expect(data.items.every((r) => r.paymentStatus === 'paid')).toBe(true);
    });

    it('forbids a caller without regView (403)', async () => {
      const jwt = await token(NOREG);
      expect((await get(jwt, '/registrations')).status).toBe(403);
    });
  });

  describe('Attendees tab', () => {
    it('lists confirmed attendees with the count badge as meta.total', async () => {
      const jwt = await token(FULL);
      const res = await get(jwt, '/attendees');
      expect(res.status).toBe(200);
      const body = res.body as Success<{ name: string; email: string }[]>;
      expect(body.meta?.total).toBe(2); // Alice + Bob (confirmed only)
      expect(body.data.every((a) => a.email.length > 0)).toBe(true);
    });

    it('forbids a caller without regView (403)', async () => {
      const jwt = await token(NOREG);
      expect((await get(jwt, '/attendees')).status).toBe(403);
    });
  });

  // ---- seeding -------------------------------------------------------------

  async function seed(): Promise<void> {
    const org = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
      [ORG.name, ORG.slug],
    );
    orgId = Number(org.rows[0].id);
    const passwordHash = await hash(PASSWORD);
    // Distinct member_role per user (roles.name is an enum, unique per org).
    await person(FULL, passwordHash, 'Admin', [
      'evCreate',
      'regView',
      'finView',
    ]);
    await person(NOFIN, passwordHash, 'Organizer', ['evCreate', 'regView']);
    await person(NOREG, passwordHash, 'Staff', ['evCreate']);

    const ev = await pool.query<{ id: string }>(
      `INSERT INTO events (organization_id, slug, name, type, bucket, start_at, organizer_name, capacity)
       VALUES ($1, 'monitored-event', 'Monitored Event', 'Conference', 'active', now() + interval '20 days', 'Acme', 100)
       RETURNING id`,
      [orgId],
    );
    eventId = ev.rows[0].id;
    const tt = await pool.query<{ id: string }>(
      `INSERT INTO ticket_types (organization_id, event_id, name, total, sold, status, price_satang)
       VALUES ($1, $2, 'General', 100, 3, 'onsale', 45000) RETURNING id`,
      [orgId, eventId],
    );
    ticketTypeId = tt.rows[0].id;

    // Two confirmed+paid orders (with issued tickets + captured payments)…
    const o1 = await order(
      'Alice',
      'alice@x.com',
      2,
      89000,
      'confirmed',
      'paid',
    );
    await tickets(o1, 2);
    await payment(o1, 89000, 'paid');
    const o2 = await order('Bob', 'bob@x.com', 1, 45000, 'confirmed', 'paid');
    await tickets(o2, 1);
    await payment(o2, 45000, 'paid');
    // …one pending, one refunded (excluded from revenue / confirmed attendees).
    await order('Carol', 'carol@x.com', 1, 45000, 'pending', 'pending');
    const o4 = await order(
      'Dave',
      'dave@x.com',
      1,
      45000,
      'cancelled',
      'refunded',
    );
    await payment(o4, 45000, 'refunded');
  }

  async function person(
    email: string,
    passwordHash: string,
    roleName: string,
    grants: string[],
  ): Promise<void> {
    const user = await pool.query<{ id: string }>(
      `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
       VALUES ($1, 'Seed', $2, 'admin', 'Active', $3) RETURNING id`,
      [orgId, email, passwordHash],
    );
    const group: Record<string, string> = {
      evCreate: 'Events',
      regView: 'Registrations',
      finView: 'Finance',
    };
    for (const key of grants) {
      await pool.query(
        `INSERT INTO permissions (key, "group", label) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO NOTHING`,
        [key, group[key], key],
      );
    }
    const role = await pool.query<{ id: string }>(
      `INSERT INTO roles (organization_id, name, description) VALUES ($1, $2, 'seed') RETURNING id`,
      [orgId, roleName],
    );
    const roleId = Number(role.rows[0].id);
    for (const key of grants) {
      await pool.query(
        `INSERT INTO role_permissions (role_id, permission_key, granted) VALUES ($1, $2, true)`,
        [roleId, key],
      );
    }
    await pool.query(
      `INSERT INTO memberships (organization_id, user_id, role_id, role, status)
       VALUES ($1, $2, $3, $4, 'Active')`,
      [orgId, user.rows[0].id, roleId, roleName],
    );
  }

  async function order(
    name: string,
    email: string,
    seats: number,
    total: number,
    status: string,
    paymentStatus: string,
  ): Promise<string> {
    seq += 1;
    const res = await pool.query<{ id: string }>(
      `INSERT INTO orders (organization_id, reference, event_id, buyer_name, buyer_email,
         status, payment_status, seats, subtotal_satang, total_satang)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING id`,
      [
        orgId,
        `ORD-${seq}`,
        eventId,
        name,
        email,
        status,
        paymentStatus,
        seats,
        total,
      ],
    );
    const orderId = res.rows[0].id;
    await pool.query(
      `INSERT INTO order_items (organization_id, order_id, ticket_type_id, quantity, unit_price_satang, line_subtotal_satang)
       VALUES ($1, $2, $3, $4, 45000, $5)`,
      [orgId, orderId, ticketTypeId, seats, total],
    );
    return orderId;
  }

  async function tickets(orderId: string, count: number): Promise<void> {
    const item = await pool.query<{ id: string }>(
      `SELECT id FROM order_items WHERE order_id = $1 LIMIT 1`,
      [orderId],
    );
    for (let i = 0; i < count; i += 1) {
      seq += 1;
      await pool.query(
        `INSERT INTO tickets (organization_id, order_id, order_item_id, event_id, ticket_type_id, qr_token, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'issued')`,
        [
          orgId,
          orderId,
          Number(item.rows[0].id),
          eventId,
          ticketTypeId,
          `QR-${seq}`,
        ],
      );
    }
  }

  async function payment(
    orderId: string,
    amount: number,
    status: string,
  ): Promise<void> {
    seq += 1;
    await pool.query(
      `INSERT INTO payments (organization_id, txn, order_id, event_id, payer_name, method, amount_satang, status, idempotency_key)
       VALUES ($1, $2, $3, $4, 'Payer', 'Card', $5, $6, $7)`,
      [orgId, `TXN-${seq}`, orderId, eventId, amount, status, `IDEM-${seq}`],
    );
  }
});

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(`DELETE FROM organizations WHERE slug = $1`, [ORG.slug]);
}
