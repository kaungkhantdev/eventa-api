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
import { listenOnLoopback } from './support/loopback';

const PASSWORD = 'correct horse battery staple';
const ORG = { slug: 'wl-auto-e2e', name: 'Waitlist Auto-offer E2E' };
const ORGANIZER = 'organizer@wl-auto-e2e.test';
const EVENT_SLUG = 'wl-auto-e2e-summit';
const HOUR = 60 * 60 * 1000;
/** Both tiers start sold out at this allocation; every raise is above it. */
const SOLD_OUT_AT = 10;
const PAID_NAME = 'General';

interface Success<T> {
  data: T;
}
interface Joined {
  orderId: string;
}
interface UpdatedTicket {
  sold: number;
  total: number;
  waitlistOffered: number;
}

/**
 * Raising a sold-out ticket's allocation offers the new places to its
 * waitlist on its own (US-REG-04), against the real schema and the whole
 * module graph: who gets a place is decided by SQL — the line's order, the
 * seat-hold engine's availability, the order's lock — so it is run, not
 * mocked.
 */
describe('Raising capacity offers the waitlist the new places (e2e — US-REG-04)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let orgId: number;
  let eventId: string;
  let paidTier: string;
  let freeTier: string;
  let organizerJwt: string;
  let seq = 0;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    orgId = await seedOrg(pool);
    ({ eventId, paidTier, freeTier } = await seedEvent(pool, orgId));

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await listenOnLoopback(app);
    server = app.getHttpServer() as Server;

    const res = await request(server).post('/api/v1/auth/login').send({
      email: ORGANIZER,
      password: PASSWORD,
      orgSlug: ORG.slug,
      persona: 'admin',
    });
    organizerJwt = (res.body as Success<{ accessToken: string }>).data
      .accessToken;
  }, 30000);

  afterEach(async () => {
    for (const table of [
      'outbox_events',
      'tickets',
      'seat_holds',
      'order_items',
      'orders',
      'attendees',
    ]) {
      await pool.query(`DELETE FROM ${table} WHERE organization_id = $1`, [
        orgId,
      ]);
    }
    // Both tickets sold out again, under their own names, and the event back
    // to a general-admission one with the waitlist on.
    await pool.query(
      `UPDATE ticket_types SET sold = $2, total = $2 WHERE organization_id = $1`,
      [orgId, SOLD_OUT_AT],
    );
    await pool.query(`UPDATE ticket_types SET name = $2 WHERE id = $1`, [
      paidTier,
      PAID_NAME,
    ]);
    await pool.query(
      `UPDATE events SET waitlist_enabled = true, seating_mode = 'ga' WHERE id = $1`,
      [eventId],
    );
  });

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  const joined = async (
    o: { tier?: string; quantity?: number } = {},
  ): Promise<string> => {
    seq += 1;
    const res = await request(server)
      .post('/api/v1/public/checkout/waitlist')
      .send({
        eventId,
        ticketTypeId: o.tier ?? paidTier,
        quantity: o.quantity ?? 1,
        buyer: { name: `Person ${seq}`, email: `p${seq}@wl-auto.test` },
        idempotencyKey: `wl-auto-key-${seq}-${Date.now()}`,
      });
    expect(res.status).toBe(201);
    return (res.body as Success<Joined>).data.orderId;
  };

  const updated = async (
    tier: string,
    body: Record<string, unknown>,
  ): Promise<UpdatedTicket> => {
    const res = await request(server)
      .patch(`/api/v1/events/${eventId}/tickets/${tier}`)
      .set('Authorization', `Bearer ${organizerJwt}`)
      .send(body);
    expect(res.status).toBe(200);
    return (res.body as Success<UpdatedTicket>).data;
  };

  const orderRow = async (id: string) =>
    (
      await pool.query<{
        status: string;
        offered_by: string | null;
        offer_skipped: number | null;
        offer_expires_at: Date | null;
        approved_at: Date | null;
        decided_by: string | null;
      }>(`SELECT * FROM orders WHERE id = $1`, [id])
    ).rows[0];

  const holdsFor = async (id: string) =>
    (
      await pool.query<{ quantity: number; status: string }>(
        `SELECT quantity, status FROM seat_holds WHERE order_id = $1`,
        [id],
      )
    ).rows;

  const outbox = async (routingKey: string) =>
    (
      await pool.query<{
        aggregate_id: string;
        payload: Record<string, unknown>;
      }>(
        `SELECT aggregate_id, payload FROM outbox_events
          WHERE organization_id = $1 AND routing_key = $2`,
        [orgId, routingKey],
      )
    ).rows;

  it('raising the allocation by 2 offers the first two in line', async () => {
    const first = await joined();
    const second = await joined();
    const third = await joined();
    const before = Date.now();

    const ticket = await updated(paidTier, { total: SOLD_OUT_AT + 2 });

    expect(ticket.waitlistOffered).toBe(2);
    for (const id of [first, second]) {
      const row = await orderRow(id);
      expect(row.status).toBe('pending');
      // Nobody chose them: the line did, in order.
      expect(row.offered_by).toBeNull();
      expect(row.offer_skipped).toBe(0);
      const until = row.offer_expires_at?.getTime() ?? 0;
      expect(until - before).toBeGreaterThanOrEqual(24 * HOUR - 5000);
      expect(until - before).toBeLessThanOrEqual(24 * HOUR + 5000);
      expect(await holdsFor(id)).toEqual([{ quantity: 1, status: 'active' }]);
    }
    expect((await orderRow(third)).status).toBe('waitlisted');
    expect(await holdsFor(third)).toEqual([]);

    const offers = await outbox('waitlist.offered');
    expect(offers.map((o) => o.aggregate_id).sort()).toEqual(
      [first, second].sort(),
    );
    for (const offer of offers) {
      expect(offer.payload).toMatchObject({ totalSatang: 105_000 });
      expect(offer.payload.payUrl).toMatch(
        new RegExp(`/my/tickets/orders/${offer.aggregate_id}$`),
      );
    }
  });

  it('a front-of-line request that does not fit stops the line', async () => {
    const front = await joined({ quantity: 3 });
    const behind = await joined({ quantity: 1 });

    const ticket = await updated(paidTier, { total: SOLD_OUT_AT + 2 });

    // Two places, and the person at the front wants three: nobody jumps them.
    expect(ticket.waitlistOffered).toBe(0);
    expect((await orderRow(front)).status).toBe('waitlisted');
    expect((await orderRow(behind)).status).toBe('waitlisted');
    expect(await holdsFor(front)).toEqual([]);
    expect(await holdsFor(behind)).toEqual([]);
  });

  it('a waitlist switched off offers nobody', async () => {
    const entry = await joined();
    await pool.query(
      `UPDATE events SET waitlist_enabled = false WHERE id = $1`,
      [eventId],
    );

    const ticket = await updated(paidTier, { total: SOLD_OUT_AT + 2 });

    expect(ticket.waitlistOffered).toBe(0);
    expect((await orderRow(entry)).status).toBe('waitlisted');
  });

  it('reserved seating offers nobody', async () => {
    const entry = await joined();
    await pool.query(
      `UPDATE events SET seating_mode = 'reserved' WHERE id = $1`,
      [eventId],
    );

    const ticket = await updated(paidTier, { total: SOLD_OUT_AT + 2 });

    expect(ticket.waitlistOffered).toBe(0);
    expect((await orderRow(entry)).status).toBe('waitlisted');
  });

  it('a free ticket is confirmed through the approval path', async () => {
    const first = await joined({ tier: freeTier });
    const second = await joined({ tier: freeTier });

    const ticket = await updated(freeTier, { total: SOLD_OUT_AT + 1 });

    expect(ticket.waitlistOffered).toBe(1);
    // The answer is the ticket as it stands after the confirmation.
    expect(ticket.sold).toBe(SOLD_OUT_AT + 1);
    const row = await orderRow(first);
    expect(row.status).toBe('confirmed');
    expect(row.approved_at).not.toBeNull();
    expect(row.decided_by).toBeNull();
    const issued = await pool.query(
      `SELECT id FROM tickets WHERE order_id = $1`,
      [first],
    );
    expect(issued.rows).toHaveLength(1);
    const confirmed = await outbox('registration.confirmed');
    expect(confirmed.map((c) => c.aggregate_id)).toEqual([first]);
    expect((await orderRow(second)).status).toBe('waitlisted');
  });

  it('a place a buyer is checking out with is not offered', async () => {
    await pool.query(
      `INSERT INTO seat_holds (organization_id, event_id, ticket_type_id, quantity, status, expires_at)
       VALUES ($1, $2, $3, 1, 'active', now() + interval '10 minutes')`,
      [orgId, eventId, paidTier],
    );
    const first = await joined();
    const second = await joined();

    const ticket = await updated(paidTier, { total: SOLD_OUT_AT + 2 });

    expect(ticket.waitlistOffered).toBe(1);
    expect((await orderRow(first)).status).toBe('pending');
    expect((await orderRow(second)).status).toBe('waitlisted');
  });

  it('an edit that does not raise the allocation offers nobody', async () => {
    const entry = await joined();

    const ticket = await updated(paidTier, { name: 'General admission' });

    expect(ticket.waitlistOffered).toBe(0);
    expect((await orderRow(entry)).status).toBe('waitlisted');
  });
});

async function seedOrg(pool: Pool): Promise<number> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
    [ORG.name, ORG.slug],
  );
  const orgId = Number(res.rows[0].id);
  await pool.query(
    `INSERT INTO permissions (key, "group", label) VALUES ('evCreate', 'Events', 'evCreate')
     ON CONFLICT (key) DO NOTHING`,
  );
  const role = await pool.query<{ id: string }>(
    `INSERT INTO roles (organization_id, name, description) VALUES ($1, 'Organizer', 'seed') RETURNING id`,
    [orgId],
  );
  await pool.query(
    `INSERT INTO role_permissions (role_id, permission_key, granted) VALUES ($1, 'evCreate', true)`,
    [role.rows[0].id],
  );
  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
     VALUES ($1, 'Seed', $2, 'admin', 'Active', $3) RETURNING id`,
    [orgId, ORGANIZER, await hash(PASSWORD)],
  );
  await pool.query(
    `INSERT INTO memberships (organization_id, user_id, role_id, role, status)
     VALUES ($1, $2, $3, 'Organizer', 'Active')`,
    [orgId, user.rows[0].id, role.rows[0].id],
  );
  return orgId;
}

/**
 * A public, general-admission event with the waitlist on and both tickets
 * sold out. The allocation sits above the per-order limit of 8, so raising it
 * through the API passes the per-order bounds check.
 */
async function seedEvent(pool: Pool, orgId: number) {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO events (organization_id, slug, name, type, bucket, status, visibility,
                         start_at, end_at, timezone, organizer_name, venue_name, city,
                         published_at, waitlist_enabled, seating_mode)
     VALUES ($1,$2,'Auto-offer Summit','Conference','active','live','public',
             now() + interval '10 days', now() + interval '10 days' + interval '8 hours',
             'Asia/Bangkok','Acme','QSNCC','Bangkok', now(), true, 'ga')
     RETURNING id`,
    [orgId, EVENT_SLUG],
  );
  const eventId = res.rows[0].id;
  const tier = async (name: string, price: number) =>
    (
      await pool.query<{ id: string }>(
        `INSERT INTO ticket_types (organization_id, event_id, name, price_satang, is_free,
                                   status, total, sold, min_per_order, max_per_order)
         VALUES ($1,$2,$3,$4,$5,'soldout',$6,$6,1,8) RETURNING id`,
        [orgId, eventId, name, price, price === 0, SOLD_OUT_AT],
      )
    ).rows[0].id;
  return {
    eventId,
    paidTier: await tier(PAID_NAME, 100_000),
    freeTier: await tier('Community', 0),
  };
}

async function cleanup(pool: Pool): Promise<void> {
  for (const table of [
    'audit_events',
    'outbox_events',
    'tickets',
    'seat_holds',
    'order_items',
    'orders',
    'attendees',
    'ticket_types',
    'events',
  ]) {
    await pool.query(
      `DELETE FROM ${table} WHERE organization_id IN
         (SELECT id FROM organizations WHERE slug = $1)`,
      [ORG.slug],
    );
  }
  await pool.query(`DELETE FROM organizations WHERE slug = $1`, [ORG.slug]);
}
