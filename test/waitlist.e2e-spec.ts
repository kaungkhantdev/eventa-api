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
const ORG = { slug: 'wl-e2e', name: 'Waitlist E2E' };
const ORGANIZER = 'organizer@wl-e2e.test';
const EVENT_SLUG = 'wl-e2e-summit';
const HOUR = 60 * 60 * 1000;

interface Success<T> {
  data: T;
}
interface Joined {
  orderId: string;
  reference: string;
  position: number;
  quantity: number;
}
interface Offer {
  outcome: string;
  offerExpiresAt: string | null;
  ticketCount: number;
}
interface Entry {
  id: string;
  status: string;
  canOffer: boolean;
  waitlistPosition: number | null;
  offerExpiresAt: string | null;
}

/**
 * The waitlist against the real schema and the whole module graph
 * (US-REG-04): joining a sold-out ticket, the organizer offering a seat, and
 * the queue the organizer sees. Every step here decides who gets a seat, so
 * the SQL behind it is run, not mocked.
 */
describe('The waitlist (e2e — US-REG-04)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let orgId: number;
  let organizerId: string;
  let eventId: string;
  let paidTier: string;
  let freeTier: string;
  let organizerJwt: string;
  let seq = 0;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    ({ orgId, organizerId } = await seedOrg(pool));
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
    // Both tickets sold out again, and the waitlist switched back on.
    await pool.query(
      `UPDATE ticket_types SET sold = 2, total = 2 WHERE organization_id = $1`,
      [orgId],
    );
    await pool.query(
      `UPDATE events SET waitlist_enabled = true WHERE id = $1`,
      [eventId],
    );
  });

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  const join = (
    o: { tier?: string; email?: string; quantity?: number; key?: string } = {},
  ) => {
    seq += 1;
    return request(server)
      .post('/api/v1/public/checkout/waitlist')
      .send({
        eventId,
        ticketTypeId: o.tier ?? paidTier,
        quantity: o.quantity ?? 1,
        buyer: { name: `Person ${seq}`, email: o.email ?? `p${seq}@wl.test` },
        idempotencyKey: o.key ?? `wl-key-${seq}-${Date.now()}`,
      });
  };

  const joined = async (
    o: Parameters<typeof join>[0] = {},
  ): Promise<Joined> => {
    const res = await join(o);
    expect(res.status).toBe(201);
    return (res.body as Success<Joined>).data;
  };

  const offer = (orderId: string) =>
    request(server)
      .post(`/api/v1/registrations/${orderId}/offer`)
      .set('Authorization', `Bearer ${organizerJwt}`)
      .send();

  const freeUp = (tier: string, seats: number) =>
    pool.query(`UPDATE ticket_types SET total = total + $2 WHERE id = $1`, [
      tier,
      seats,
    ]);

  const orderRow = async (id: string) =>
    (
      await pool.query<{
        status: string;
        payment_status: string;
        total_satang: string;
        offered_by: string | null;
        offer_skipped: number | null;
        offer_expires_at: Date | null;
      }>(`SELECT * FROM orders WHERE id = $1`, [id])
    ).rows[0];

  const holdsFor = async (id: string) =>
    (
      await pool.query<{ quantity: number; status: string }>(
        `SELECT quantity, status FROM seat_holds WHERE order_id = $1`,
        [id],
      )
    ).rows;

  describe('joining', () => {
    it('shows a sold-out ticket as one to wait for', async () => {
      const res = await request(server).get(
        `/api/v1/public/checkout/${EVENT_SLUG}`,
      );
      const tiers = (
        res.body as Success<{ tiers: { id: string; waitlist: boolean }[] }>
      ).data.tiers;
      expect(tiers.find((t) => t.id === paidTier)?.waitlist).toBe(true);
    });

    it('puts a buyer in line, priced now, holding nothing', async () => {
      const entry = await joined({ quantity: 2 });
      expect(entry.position).toBe(1);
      expect(entry.quantity).toBe(2);
      const row = await orderRow(entry.orderId);
      expect(row.status).toBe('waitlisted');
      expect(row.payment_status).toBe('pending');
      // ฿1,000 × 2 plus the 5% service fee.
      expect(Number(row.total_satang)).toBe(210_000);
      expect(await holdsFor(entry.orderId)).toEqual([]);
    });

    it('counts who is ahead', async () => {
      await joined();
      await joined();
      expect((await joined()).position).toBe(3);
    });

    it('gives somebody already waiting their place back, not a second one', async () => {
      const first = await joined({ email: 'twice@wl.test' });
      await joined();
      const again = await joined({ email: 'TWICE@wl.test' });
      expect(again.orderId).toBe(first.orderId);
      expect(again.position).toBe(1);
    });

    it('answers a repeated request with the entry it already made', async () => {
      const first = await joined({ key: 'same-key-123456' });
      const again = await joined({ key: 'same-key-123456' });
      expect(again.orderId).toBe(first.orderId);
    });

    it('refuses when the organizer has not switched the waitlist on', async () => {
      await pool.query(
        `UPDATE events SET waitlist_enabled = false WHERE id = $1`,
        [eventId],
      );
      expect((await join()).status).toBe(422);
    });

    it('sends a buyer back to buy when tickets are left', async () => {
      await freeUp(paidTier, 1);
      expect((await join()).status).toBe(409);
    });
  });

  describe('offering a seat', () => {
    it('refuses while no seat is free, and leaves them in line', async () => {
      const entry = await joined();
      const res = await offer(entry.orderId);
      expect(res.status).toBe(409);
      expect((res.body as { message: string }).message).toMatch(
        /No seat is free/,
      );
      expect((await orderRow(entry.orderId)).status).toBe('waitlisted');
      expect(await holdsFor(entry.orderId)).toEqual([]);
    });

    it('holds the seat for a day, records who offered it, and queues the email', async () => {
      const entry = await joined();
      await freeUp(paidTier, 1);
      const before = Date.now();

      const res = await offer(entry.orderId);

      expect(res.status).toBe(201);
      const result = (res.body as Success<Offer>).data;
      expect(result.outcome).toBe('offered');
      const until = new Date(result.offerExpiresAt ?? '').getTime();
      expect(until - before).toBeGreaterThanOrEqual(24 * HOUR - 5000);
      expect(until - before).toBeLessThanOrEqual(24 * HOUR + 5000);

      const row = await orderRow(entry.orderId);
      expect(row.status).toBe('pending');
      expect(row.offered_by).toBe(organizerId);
      expect(row.offer_skipped).toBe(0);
      expect(await holdsFor(entry.orderId)).toEqual([
        { quantity: 1, status: 'active' },
      ]);

      const outbox = await pool.query<{
        routing_key: string;
        payload: Record<string, unknown>;
      }>(
        `SELECT routing_key, payload FROM outbox_events WHERE aggregate_id = $1`,
        [entry.orderId],
      );
      expect(outbox.rows).toHaveLength(1);
      expect(outbox.rows[0].routing_key).toBe('waitlist.offered');
      expect(outbox.rows[0].payload).toMatchObject({
        ticketTypeName: 'General',
        ticketCount: 1,
        totalSatang: 105_000,
      });
      expect(outbox.rows[0].payload.payUrl).toMatch(
        new RegExp(`/my/tickets/orders/${entry.orderId}$`),
      );
    });

    it('records how many were passed over when someone is chosen out of order', async () => {
      await joined();
      await joined();
      const third = await joined();
      await freeUp(paidTier, 1);
      expect((await offer(third.orderId)).status).toBe(201);
      expect((await orderRow(third.orderId)).offer_skipped).toBe(2);
    });

    it('holds nothing twice when the offer is retried', async () => {
      const entry = await joined();
      await freeUp(paidTier, 2);
      await offer(entry.orderId);
      const again = await offer(entry.orderId);
      expect((again.body as Success<Offer>).data.outcome).toBe(
        'already_offered',
      );
      expect(await holdsFor(entry.orderId)).toHaveLength(1);
    });

    it('confirms a free ticket at once, with its ticket', async () => {
      const entry = await joined({ tier: freeTier });
      await freeUp(freeTier, 1);
      const res = await offer(entry.orderId);
      expect((res.body as Success<Offer>).data).toMatchObject({
        outcome: 'confirmed',
        ticketCount: 1,
        offerExpiresAt: null,
      });
      expect((await orderRow(entry.orderId)).status).toBe('confirmed');
    });
  });

  describe('the queue the organizer sees', () => {
    it('shows each person’s place in line, and that a seat can be offered', async () => {
      const first = await joined();
      const second = await joined();
      const res = await request(server)
        .get('/api/v1/registrations')
        .query({ status: 'waitlisted', eventId })
        .set('Authorization', `Bearer ${organizerJwt}`);
      const items = (res.body as Success<Entry[]>).data;
      const place = (id: string) => items.find((i) => i.id === id);
      expect(place(first.orderId)).toMatchObject({
        waitlistPosition: 1,
        canOffer: true,
      });
      expect(place(second.orderId)?.waitlistPosition).toBe(2);
    });

    it('shows when an open offer runs out', async () => {
      const entry = await joined();
      await freeUp(paidTier, 1);
      await offer(entry.orderId);
      const res = await request(server)
        .get('/api/v1/registrations')
        .query({ eventId })
        .set('Authorization', `Bearer ${organizerJwt}`);
      const row = (res.body as Success<Entry[]>).data.find(
        (i) => i.id === entry.orderId,
      );
      expect(row).toMatchObject({ status: 'pending', canOffer: false });
      expect(row?.offerExpiresAt).not.toBeNull();
      expect(row?.waitlistPosition).toBeNull();
    });
  });
});

async function seedOrg(
  pool: Pool,
): Promise<{ orgId: number; organizerId: string }> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
    [ORG.name, ORG.slug],
  );
  const orgId = Number(res.rows[0].id);
  for (const key of ['regView', 'regManage']) {
    await pool.query(
      `INSERT INTO permissions (key, "group", label) VALUES ($1, 'Registrations', $2)
       ON CONFLICT (key) DO NOTHING`,
      [key, key],
    );
  }
  const role = await pool.query<{ id: string }>(
    `INSERT INTO roles (organization_id, name, description) VALUES ($1, 'Organizer', 'seed') RETURNING id`,
    [orgId],
  );
  for (const key of ['regView', 'regManage']) {
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_key, granted) VALUES ($1, $2, true)`,
      [role.rows[0].id, key],
    );
  }
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
  return { orgId, organizerId: user.rows[0].id };
}

/** A public, general-admission event with the waitlist on and both tickets sold out. */
async function seedEvent(pool: Pool, orgId: number) {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO events (organization_id, slug, name, type, bucket, status, visibility,
                         start_at, end_at, timezone, organizer_name, venue_name, city,
                         published_at, waitlist_enabled)
     VALUES ($1,$2,'Waitlist Summit','Conference','active','live','public',
             now() + interval '10 days', now() + interval '10 days' + interval '8 hours',
             'Asia/Bangkok','Acme','QSNCC','Bangkok', now(), true)
     RETURNING id`,
    [orgId, EVENT_SLUG],
  );
  const eventId = res.rows[0].id;
  const tier = async (name: string, price: number) =>
    (
      await pool.query<{ id: string }>(
        `INSERT INTO ticket_types (organization_id, event_id, name, price_satang, is_free,
                                   status, total, sold, min_per_order, max_per_order)
         VALUES ($1,$2,$3,$4,$5,'onsale',2,2,1,8) RETURNING id`,
        [orgId, eventId, name, price, price === 0],
      )
    ).rows[0].id;
  return {
    eventId,
    paidTier: await tier('General', 100_000),
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
