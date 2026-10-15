process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://eventa:eventa@localhost:5432/eventa';
process.env.JWT_SECRET ??= 'test-secret-at-least-16-characters-long';

import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { buildValidationPipe } from '../src/common/http/validation';
import { listenOnLoopback } from './support/loopback';

const ORG = { slug: 'bookclaim-e2e', name: 'Booking Claim E2E' };
const BUYER = { name: 'Anan Suksawat', email: 'anan@bookclaim.test' };
/** Somebody whose address a stranger booked with — they never asked for this. */
const VICTIM = { name: 'Malee Wongsa', email: 'malee@bookclaim.test' };
const UNKNOWN_ORDER = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';
const LINK_ROUTING_KEY = 'identity.booking_account_link_requested';
const PUBLIC_WEB_URL = 'http://localhost:5173';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const PAYLOAD_KEYS = [
  'claimUrl',
  'email',
  'eventName',
  'expiresAt',
  'locale',
  'name',
  'occurredAt',
  'orderId',
  'organizationId',
  'version',
];

interface Success<T> {
  data: T;
}
interface Failure {
  message: string;
  code?: string;
}
interface OutboxRow {
  organization_id: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
}

/** The throttle's own key for a booking-claim email, as the service spells it. */
const coolOffKey = (email: string) =>
  `verify:resend:booking-claim:${email.toLowerCase()}`;

/**
 * Create my account from my confirmation (US-DISC-15), through the real
 * checkout and the real AppModule.
 *
 * The trust rule under test: the order id is shown in the BOOKER's browser
 * before anybody reads the buyer's inbox, so it proves nothing about the
 * address. Holding it can only ask for a one-time link to be emailed to the
 * booking's address; no account exists, and no password is chosen, until that
 * link is opened.
 */
describe('Account from a booking (e2e — US-DISC-15)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let redis: Redis;
  let platformOrgId: number;
  /** The buyer's earlier booking, made before any account existed. */
  let earlierOrderId: string;
  /** The booking the buyer turns into an account. */
  let orderId: string;
  let orderReference: string;
  /** A stranger's booking made with the victim's address. */
  let strangersOrderId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    redis = process.env.REDIS_URL
      ? new Redis(process.env.REDIS_URL)
      : new Redis();
    await cleanup(pool, redis);
    const seeded = await seed(pool);
    platformOrgId = seeded.platformOrgId;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await listenOnLoopback(app);
    server = app.getHttpServer() as Server;

    earlierOrderId = (
      await placeFreeOrder(server, seeded.earlier, BUYER, 'earlier')
    ).orderId;
    ({ orderId, reference: orderReference } = await placeFreeOrder(
      server,
      seeded.latest,
      BUYER,
      'latest',
    ));
    strangersOrderId = (
      await placeFreeOrder(server, seeded.latest, VICTIM, 'stranger')
    ).orderId;
  }, 30000);

  afterAll(async () => {
    await cleanup(pool, redis);
    await redis.quit();
    await pool.end();
    await app.close();
  });

  const accountFor = (id: string) =>
    request(server).get(`/api/v1/auth/register/from-booking/${id}`);

  const requestLink = (id: string) =>
    request(server).post(`/api/v1/auth/register/from-booking/${id}/link`);

  const linkRows = async (id: string): Promise<OutboxRow[]> => {
    const { rows } = await pool.query<OutboxRow>(
      `SELECT organization_id, aggregate_type, aggregate_id, payload
         FROM outbox_events
        WHERE routing_key = $1 AND aggregate_id = $2
        ORDER BY id`,
      [LINK_ROUTING_KEY, id],
    );
    return rows;
  };

  const attendeeAccounts = async (email: string) => {
    const { rows } = await pool.query<{
      name: string;
      email: string;
      status: string;
      organization_id: string;
    }>(
      `SELECT name, email, status, organization_id FROM users
        WHERE email = $1 AND persona = 'attendee' AND deleted_at IS NULL`,
      [email],
    );
    return rows;
  };

  describe('the offer on the confirmation screen', () => {
    it('says no account uses the booking’s email yet', async () => {
      const res = await accountFor(orderId);

      expect(res.status).toBe(200);
      expect((res.body as Success<unknown>).data).toEqual({
        accountExists: false,
      });
    });

    it('answers 404 for an order that does not exist', async () => {
      expect((await accountFor(UNKNOWN_ORDER)).status).toBe(404);
      expect((await requestLink(UNKNOWN_ORDER)).status).toBe(404);
    });

    it('identifies a booking only by its uuid, never its printed reference (400)', async () => {
      expect(orderReference).toEqual(expect.any(String));

      expect((await accountFor(orderReference)).status).toBe(400);
      expect((await requestLink(orderReference)).status).toBe(400);
      expect(await linkRows(orderId)).toHaveLength(0);
    });
  });

  describe('asking for the link', () => {
    it('answers 202 with where it went — the booking’s own address', async () => {
      const res = await requestLink(orderId);

      expect(res.status).toBe(202);
      expect((res.body as Success<unknown>).data).toEqual({
        sentTo: BUYER.email,
      });
    });

    it('queues exactly one email, from the platform, in the contract’s exact shape', async () => {
      const rows = await linkRows(orderId);

      expect(rows).toHaveLength(1);
      const [row] = rows;
      expect(Number(row.organization_id)).toBe(platformOrgId);
      expect(row.aggregate_type).toBe('order');
      expect(row.aggregate_id).toBe(orderId);
      expect(Object.keys(row.payload).sort()).toEqual(PAYLOAD_KEYS);
      expect(row.payload).toMatchObject({
        version: 1,
        organizationId: platformOrgId,
        orderId,
        name: BUYER.name,
        email: BUYER.email,
        eventName: 'Latest Meetup',
        // The workspace speaks Thai and the event names no language of its
        // own: the language the booking's own confirmation was written in.
        locale: 'th',
      });
    });

    it('carries a link to the web’s claim page that expires in seven days', async () => {
      const [{ payload }] = await linkRows(orderId);
      const claimUrl = new URL(payload.claimUrl as string);
      const expiresAt = Date.parse(payload.expiresAt as string);
      const occurredAt = Date.parse(payload.occurredAt as string);

      expect(`${claimUrl.origin}${claimUrl.pathname}`).toBe(
        `${PUBLIC_WEB_URL}/portal/register`,
      );
      expect(claimUrl.searchParams.get('claim')).toMatch(
        /^[\w-]+\.[\w-]+\.[\w-]+$/,
      );
      expect(payload.expiresAt).toBe(new Date(expiresAt).toISOString());
      expect(payload.occurredAt).toBe(new Date(occurredAt).toISOString());
      expect(expiresAt - occurredAt).toBeGreaterThan(SEVEN_DAYS_MS - 5000);
      expect(expiresAt - occurredAt).toBeLessThanOrEqual(SEVEN_DAYS_MS + 1000);
    });

    it('creates no account and chooses no password', async () => {
      expect(await attendeeAccounts(BUYER.email)).toHaveLength(0);
    });

    it('refuses a second link straight after with the throttle’s own words, sending nothing', async () => {
      const res = await requestLink(orderId);

      expect(res.status).toBe(429);
      expect((res.body as Failure).message).toBe(
        'A confirmation link was just sent. Give it a minute before asking for another.',
      );
      expect(await linkRows(orderId)).toHaveLength(1);
    });

    it('rations per address: the same buyer’s other booking waits too', async () => {
      const res = await requestLink(earlierOrderId);

      expect(res.status).toBe(429);
      expect(await linkRows(earlierOrderId)).toHaveLength(0);
    });
  });

  describe('a booking made with somebody else’s address', () => {
    it('can only send that address its own link — the booker never sees it', async () => {
      const res = await requestLink(strangersOrderId);

      expect(res.status).toBe(202);
      expect((res.body as Success<unknown>).data).toEqual({
        sentTo: VICTIM.email,
      });
      const [{ payload }] = await linkRows(strangersOrderId);
      const token = new URL(payload.claimUrl as string).searchParams.get(
        'claim',
      );
      expect(JSON.stringify(res.body)).not.toContain(token);
      expect(JSON.stringify(res.body)).not.toContain('claim=');
      expect(await attendeeAccounts(VICTIM.email)).toHaveLength(0);
    });

    it('cannot create the account from the order id and a password — that route does not exist', async () => {
      const res = await request(server)
        .post('/api/v1/auth/register/from-booking')
        .send({
          orderId: strangersOrderId,
          password: 'chosen-by-stranger1!',
          acceptTerms: true,
        });

      expect(res.status).toBe(404);
      expect(await attendeeAccounts(VICTIM.email)).toHaveLength(0);
    });

    it('cannot pass a password along with the link request', async () => {
      await redis.del(coolOffKey(VICTIM.email));

      await request(server)
        .post(`/api/v1/auth/register/from-booking/${strangersOrderId}/link`)
        .send({ password: 'chosen-by-stranger1!', acceptTerms: true });

      expect(await attendeeAccounts(VICTIM.email)).toHaveLength(0);
    });
  });
});

interface Seeded {
  platformOrgId: number;
  earlier: { eventId: string; tierId: string };
  latest: { eventId: string; tierId: string };
}

async function seed(pool: Pool): Promise<Seeded> {
  const platform = await pool.query<{ id: string }>(
    `SELECT id FROM organizations WHERE slug = 'eventa'`,
  );
  const org = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug, locale) VALUES ($1,$2,'th') RETURNING id`,
    [ORG.name, ORG.slug],
  );
  const orgId = Number(org.rows[0].id);
  return {
    platformOrgId: Number(platform.rows[0].id),
    earlier: await insertEvent(pool, orgId, 'bookclaim-first', 'First Meetup'),
    latest: await insertEvent(pool, orgId, 'bookclaim-latest', 'Latest Meetup'),
  };
}

async function insertEvent(
  pool: Pool,
  orgId: number,
  slug: string,
  name: string,
): Promise<{ eventId: string; tierId: string }> {
  const event = await pool.query<{ id: string }>(
    `INSERT INTO events (organization_id, slug, name, type, bucket, status, visibility,
                         start_at, end_at, timezone, organizer_name, venue_name, city, published_at)
     VALUES ($1,$2,$3,'Conference','active','upcoming','public',
             now() + interval '30 days', now() + interval '30 days 6 hours',
             'Asia/Bangkok','Acme','QSNCC','Bangkok', now())
     RETURNING id`,
    [orgId, slug, name],
  );
  const tier = await pool.query<{ id: string }>(
    `INSERT INTO ticket_types (organization_id, event_id, name, price_satang, is_free,
                               status, total, sold, min_per_order, max_per_order)
     VALUES ($1,$2,'RSVP',0,true,'onsale',100,0,1,8) RETURNING id`,
    [orgId, event.rows[0].id],
  );
  return { eventId: event.rows[0].id, tierId: tier.rows[0].id };
}

/** A guest RSVP through the real checkout — no account anywhere. */
async function placeFreeOrder(
  server: Server,
  at: { eventId: string; tierId: string },
  buyer: { name: string; email: string },
  key: string,
): Promise<{ orderId: string; reference: string }> {
  const held = await request(server)
    .post('/api/v1/public/checkout/hold')
    .send({ eventId: at.eventId, ticketTypeId: at.tierId, quantity: 1 });
  expect(held.status).toBe(201);
  const res = await request(server)
    .post('/api/v1/public/checkout/confirm')
    .send({
      eventId: at.eventId,
      ticketTypeId: at.tierId,
      quantity: 1,
      holdIds: (held.body as Success<{ holdIds: number[] }>).data.holdIds,
      buyer,
      idempotencyKey: `bookclaim-${key}`,
    });
  expect(res.status).toBe(201);
  return (res.body as Success<{ orderId: string; reference: string }>).data;
}

async function cleanup(pool: Pool, redis: Redis): Promise<void> {
  await redis.del(coolOffKey(BUYER.email), coolOffKey(VICTIM.email));
  await pool.query(
    `DELETE FROM outbox_events WHERE routing_key = $1
        AND payload->>'email' LIKE '%@bookclaim.test'`,
    [LINK_ROUTING_KEY],
  );
  await pool.query(
    `DELETE FROM outbox_events WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug = $1)`,
    [ORG.slug],
  );
  await pool.query(
    `DELETE FROM outbox_events WHERE aggregate_id IN
       (SELECT id::text FROM users WHERE email LIKE '%@bookclaim.test')`,
  );
  // audit_events is ON DELETE RESTRICT (a sign-in writes one), so clear it first.
  await pool.query(
    `DELETE FROM audit_events WHERE actor_user_id IN
       (SELECT id FROM users WHERE email LIKE '%@bookclaim.test')`,
  );
  await pool.query(`DELETE FROM users WHERE email LIKE '%@bookclaim.test'`);
  await pool.query(
    `DELETE FROM audit_events WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug = $1)`,
    [ORG.slug],
  );
  await pool.query(`DELETE FROM organizations WHERE slug = $1`, [ORG.slug]);
}
