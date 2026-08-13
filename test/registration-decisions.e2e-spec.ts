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
const ORG = { slug: 'dec-e2e', name: 'Decisions E2E' };
const ORG2 = { slug: 'dec-e2e-2', name: 'Decisions E2E 2' };
const ORGANIZER = 'organizer@dec-e2e.test';
const STAFF = 'staff@dec-e2e.test';
const ADMIN2 = 'admin@dec-e2e-2.test';
const BAHT = 100;

interface Success<T> {
  data: T;
}
interface Decision {
  outcome: string;
  reference: string;
  ticketCount: number;
}
interface Failure {
  message: string;
}

describe('Approving and rejecting registrations (e2e — US-REG-02)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let orgId: number;
  let otherOrgId: number;
  let eventId: string;
  let organizerJwt: string;
  let staffJwt: string;
  let seq = 0;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    orgId = await seedOrg(pool, ORG, [
      {
        email: ORGANIZER,
        roleName: 'Organizer',
        grants: ['regView', 'regManage'],
      },
      { email: STAFF, roleName: 'Staff', grants: ['regView'] },
    ]);
    otherOrgId = await seedOrg(pool, ORG2, [
      { email: ADMIN2, roleName: 'Admin', grants: ['regView', 'regManage'] },
    ]);
    eventId = await seedEvent(pool, orgId, 'dec-summit');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();
    server = app.getHttpServer() as Server;

    organizerJwt = await token(ORGANIZER, ORG.slug);
    staffJwt = await token(STAFF, ORG.slug);
  }, 30000);

  afterEach(async () => {
    const orgs = [orgId, otherOrgId];
    for (const table of [
      'tickets',
      'seat_holds',
      'order_items',
      'orders',
      'outbox_events',
      'audit_events',
    ]) {
      await pool.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [
        orgs,
      ]);
    }
    await pool.query(
      `UPDATE ticket_types SET sold = 0, total = 100 WHERE organization_id = ANY($1)`,
      [orgs],
    );
  });

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  async function token(email: string, orgSlug: string): Promise<string> {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, orgSlug, persona: 'admin' });
    return (res.body as Success<{ accessToken: string }>).data.accessToken;
  }

  /** A sign-up awaiting a decision: pending, unticketed, one seat held. */
  async function seedRegistration(
    o: {
      status?: string;
      paymentStatus?: string;
      totalSatang?: number;
      org?: number;
      event?: string;
    } = {},
  ): Promise<string> {
    seq += 1;
    const org = o.org ?? orgId;
    const event = o.event ?? eventId;
    const total = o.totalSatang ?? 0;
    const order = await pool.query<{ id: string }>(
      `INSERT INTO orders (organization_id, reference, event_id, buyer_name, buyer_email,
                           status, payment_status, seats, subtotal_satang, total_satang)
       VALUES ($1,$2,$3,'Anan Suksawat','anan@dec.test',$4,$5,1,$6,$6)
       RETURNING id`,
      [
        org,
        `ORD-DEC-${seq}`,
        event,
        o.status ?? 'pending',
        o.paymentStatus ?? 'pending',
        total,
      ],
    );
    const orderId = order.rows[0].id;
    const tier = await pool.query<{ id: string }>(
      `SELECT id FROM ticket_types WHERE event_id = $1 LIMIT 1`,
      [event],
    );
    await pool.query(
      `INSERT INTO order_items (organization_id, order_id, ticket_type_id, quantity,
                                unit_price_satang, line_subtotal_satang)
       VALUES ($1,$2,$3,1,$4,$4)`,
      [org, orderId, tier.rows[0].id, total],
    );
    await pool.query(
      `INSERT INTO seat_holds (organization_id, event_id, ticket_type_id, order_id,
                               quantity, status, expires_at)
       VALUES ($1,$2,$3,$4,1,'active', now() + interval '1 hour')`,
      [org, event, tier.rows[0].id, orderId],
    );
    return orderId;
  }

  const approve = (jwt: string, id: string) =>
    request(server)
      .post(`/api/v1/registrations/${id}/approve`)
      .set('Authorization', `Bearer ${jwt}`)
      .send();

  const reject = (jwt: string, id: string, body: object) =>
    request(server)
      .post(`/api/v1/registrations/${id}/reject`)
      .set('Authorization', `Bearer ${jwt}`)
      .send(body);

  const ticketCount = async (orderId: string) => {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*) FROM tickets WHERE order_id = $1`,
      [orderId],
    );
    return Number(rows[0].count);
  };

  const orderRow = async (orderId: string) => {
    const { rows } = await pool.query<{
      status: string;
      payment_status: string;
      confirmed_at: string | null;
      approved_at: string | null;
      rejected_at: string | null;
      decided_by: string | null;
      rejection_reason: string | null;
    }>(`SELECT * FROM orders WHERE id = $1`, [orderId]);
    return rows[0];
  };

  describe('approving (US-REG-02)', () => {
    it('confirms a free registration and issues a ticket with a QR', async () => {
      const orderId = await seedRegistration();
      const res = await approve(organizerJwt, orderId);
      expect(res.status).toBe(201);
      const decision = (res.body as Success<Decision>).data;
      expect(decision.outcome).toBe('approved');
      expect(decision.ticketCount).toBe(1);

      const row = await orderRow(orderId);
      expect(row.status).toBe('confirmed');
      expect(row.confirmed_at).not.toBeNull();
      expect(row.approved_at).not.toBeNull();
      expect(row.decided_by).not.toBeNull();

      const { rows } = await pool.query<{ qr_token: string; status: string }>(
        `SELECT qr_token, status FROM tickets WHERE order_id = $1`,
        [orderId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].qr_token).toBeTruthy();
      expect(rows[0].status).toBe('issued');
    });

    it('converts the seat hold and counts the seat against the tier', async () => {
      const orderId = await seedRegistration();
      await approve(organizerJwt, orderId);
      const holds = await pool.query<{ status: string }>(
        `SELECT status FROM seat_holds WHERE organization_id = $1`,
        [orgId],
      );
      expect(holds.rows[0].status).toBe('converted');
      const tier = await pool.query<{ sold: number }>(
        `SELECT sold FROM ticket_types WHERE event_id = $1`,
        [eventId],
      );
      expect(tier.rows[0].sold).toBe(1);
    });

    it('queues exactly one confirmation for the attendee', async () => {
      const orderId = await seedRegistration();
      await approve(organizerJwt, orderId);
      const { rows } = await pool.query<{ routing_key: string }>(
        `SELECT routing_key FROM outbox_events WHERE aggregate_id = $1`,
        [orderId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].routing_key).toBe('registration.confirmed');
    });

    it('issues one ticket and one confirmation when the approval is retried', async () => {
      const orderId = await seedRegistration();
      const first = await approve(organizerJwt, orderId);
      const second = await approve(organizerJwt, orderId);
      expect(first.status).toBe(201);
      expect((second.body as Success<Decision>).data.outcome).toBe(
        'already_approved',
      );
      expect(await ticketCount(orderId)).toBe(1);
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*) FROM outbox_events WHERE aggregate_id = $1`,
        [orderId],
      );
      expect(Number(rows[0].count)).toBe(1);
    });

    it('blocks a paid registration whose money has not arrived', async () => {
      const orderId = await seedRegistration({
        totalSatang: 1_500 * BAHT,
        paymentStatus: 'pending',
      });
      const res = await approve(organizerJwt, orderId);
      expect(res.status).toBe(409);
      expect((res.body as Failure).message).toMatch(/payment isn't complete/i);
      expect(await ticketCount(orderId)).toBe(0);
      expect((await orderRow(orderId)).status).toBe('pending');
    });

    it('approves a paid registration once the money is in', async () => {
      const orderId = await seedRegistration({
        totalSatang: 1_500 * BAHT,
        paymentStatus: 'paid',
      });
      const res = await approve(organizerJwt, orderId);
      expect(res.status).toBe(201);
      expect(await ticketCount(orderId)).toBe(1);
    });

    it('approves a waitlisted registration into a freed seat', async () => {
      const orderId = await seedRegistration({ status: 'waitlisted' });
      const res = await approve(organizerJwt, orderId);
      expect(res.status).toBe(201);
      expect((await orderRow(orderId)).status).toBe('confirmed');
    });

    it('leaves the registration PENDING and offers the waitlist when it sold out', async () => {
      const orderId = await seedRegistration();
      await pool.query(
        `UPDATE ticket_types SET total = 5, sold = 5 WHERE event_id = $1`,
        [eventId],
      );
      const res = await approve(organizerJwt, orderId);
      expect(res.status).toBe(409);
      expect((res.body as Failure).message).toMatch(/waitlist/i);
      // The whole point: a sell-out must not terminate the sign-up.
      const row = await orderRow(orderId);
      expect(row.status).toBe('pending');
      expect(row.payment_status).toBe('pending');
      expect(await ticketCount(orderId)).toBe(0);
      const outbox = await pool.query<{ count: string }>(
        `SELECT count(*) FROM outbox_events WHERE aggregate_id = $1`,
        [orderId],
      );
      expect(Number(outbox.rows[0].count)).toBe(0);
    });

    it('refuses to re-approve a rejected registration', async () => {
      const orderId = await seedRegistration();
      await reject(organizerJwt, orderId, { confirm: true });
      const res = await approve(organizerJwt, orderId);
      expect(res.status).toBe(409);
      expect((res.body as Failure).message).toMatch(/rejected/i);
      expect(await ticketCount(orderId)).toBe(0);
    });

    it('403s Staff — working the queue is not deciding it', async () => {
      const orderId = await seedRegistration();
      expect((await approve(staffJwt, orderId)).status).toBe(403);
      expect(await ticketCount(orderId)).toBe(0);
    });

    it('404s a registration in another workspace', async () => {
      const otherEvent = await seedEvent(pool, otherOrgId, 'dec-other');
      const orderId = await seedRegistration({
        org: otherOrgId,
        event: otherEvent,
      });
      expect((await approve(organizerJwt, orderId)).status).toBe(404);
    });
  });

  describe('rejecting (US-REG-02)', () => {
    it('releases the held seat and records the reason', async () => {
      const orderId = await seedRegistration();
      const res = await reject(organizerJwt, orderId, {
        confirm: true,
        reason: 'Duplicate sign-up',
      });
      expect(res.status).toBe(201);
      const row = await orderRow(orderId);
      expect(row.status).toBe('rejected');
      expect(row.rejected_at).not.toBeNull();
      expect(row.decided_by).not.toBeNull();
      expect(row.rejection_reason).toBe('Duplicate sign-up');
      const holds = await pool.query<{ status: string }>(
        `SELECT status FROM seat_holds WHERE order_id = $1`,
        [orderId],
      );
      expect(holds.rows[0].status).toBe('released');
      expect(await ticketCount(orderId)).toBe(0);
    });

    it('queues the rejection notice in the same transaction', async () => {
      const orderId = await seedRegistration();
      await reject(organizerJwt, orderId, { confirm: true });
      const { rows } = await pool.query<{ routing_key: string }>(
        `SELECT routing_key FROM outbox_events WHERE aggregate_id = $1`,
        [orderId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].routing_key).toBe('registration.rejected');
    });

    it('demands the confirmation, so one misclick cannot terminate a sign-up', async () => {
      const orderId = await seedRegistration();
      const res = await reject(organizerJwt, orderId, { confirm: false });
      expect(res.status).toBe(422);
      expect((await orderRow(orderId)).status).toBe('pending');
    });

    it('releases and notifies once when the rejection is retried', async () => {
      const orderId = await seedRegistration();
      await reject(organizerJwt, orderId, { confirm: true });
      const second = await reject(organizerJwt, orderId, { confirm: true });
      expect(second.status).toBe(201);
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*) FROM outbox_events WHERE aggregate_id = $1`,
        [orderId],
      );
      expect(Number(rows[0].count)).toBe(1);
    });

    it('refuses once money has been captured, pointing at the refund', async () => {
      const orderId = await seedRegistration({
        totalSatang: 1_500 * BAHT,
        paymentStatus: 'paid',
      });
      const res = await reject(organizerJwt, orderId, { confirm: true });
      expect(res.status).toBe(409);
      expect((res.body as Failure).message).toMatch(/refund/i);
      expect((await orderRow(orderId)).status).toBe('pending');
    });

    it('refuses to reject a confirmed registration', async () => {
      const orderId = await seedRegistration();
      await approve(organizerJwt, orderId);
      const res = await reject(organizerJwt, orderId, { confirm: true });
      expect(res.status).toBe(409);
      expect((await orderRow(orderId)).status).toBe('confirmed');
    });

    it('403s Staff', async () => {
      const orderId = await seedRegistration();
      const res = await reject(staffJwt, orderId, { confirm: true });
      expect(res.status).toBe(403);
    });
  });
});

const PERM_GROUP: Record<string, string> = {
  regView: 'Registrations',
  regManage: 'Registrations',
};

async function seedOrg(
  pool: Pool,
  org: { slug: string; name: string },
  people: { email: string; roleName: string; grants: string[] }[],
): Promise<number> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
    [org.name, org.slug],
  );
  const orgId = Number(res.rows[0].id);
  const passwordHash = await hash(PASSWORD);
  for (const p of people) {
    for (const key of p.grants) {
      await pool.query(
        `INSERT INTO permissions (key, "group", label) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO NOTHING`,
        [key, PERM_GROUP[key], key],
      );
    }
    const role = await pool.query<{ id: string }>(
      `INSERT INTO roles (organization_id, name, description) VALUES ($1, $2, 'seed') RETURNING id`,
      [orgId, p.roleName],
    );
    const roleId = Number(role.rows[0].id);
    for (const key of p.grants) {
      await pool.query(
        `INSERT INTO role_permissions (role_id, permission_key, granted) VALUES ($1, $2, true)`,
        [roleId, key],
      );
    }
    const user = await pool.query<{ id: string }>(
      `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
       VALUES ($1, 'Seed', $2, 'admin', 'Active', $3) RETURNING id`,
      [orgId, p.email, passwordHash],
    );
    await pool.query(
      `INSERT INTO memberships (organization_id, user_id, role_id, role, status)
       VALUES ($1, $2, $3, $4, 'Active')`,
      [orgId, user.rows[0].id, roleId, p.roleName],
    );
  }
  return orgId;
}

async function seedEvent(
  pool: Pool,
  orgId: number,
  slug: string,
): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO events (organization_id, slug, name, type, bucket, status, visibility,
                         start_at, end_at, timezone, organizer_name, venue_name, city, published_at)
     VALUES ($1,$2,'Decisions Summit','Conference','active','live','public',
             now() + interval '10 days', now() + interval '10 days' + interval '8 hours',
             'Asia/Bangkok','Acme','QSNCC','Bangkok', now())
     RETURNING id`,
    [orgId, slug],
  );
  const eventId = res.rows[0].id;
  await pool.query(
    `INSERT INTO ticket_types (organization_id, event_id, name, price_satang,
                               status, total, sold, min_per_order, max_per_order)
     VALUES ($1,$2,'General',0,'onsale',100,0,1,8)`,
    [orgId, eventId],
  );
  return eventId;
}

async function cleanup(pool: Pool): Promise<void> {
  const slugs = [ORG.slug, ORG2.slug];
  // Order matters: tickets reference events ON DELETE RESTRICT.
  for (const table of [
    'audit_events',
    'outbox_events',
    'tickets',
    'seat_holds',
    'order_items',
    'orders',
    'ticket_types',
    'events',
  ]) {
    await pool.query(
      `DELETE FROM ${table} WHERE organization_id IN
         (SELECT id FROM organizations WHERE slug = ANY($1))`,
      [slugs],
    );
  }
  await pool.query(`DELETE FROM organizations WHERE slug = ANY($1)`, [slugs]);
}
