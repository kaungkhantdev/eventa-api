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
const ORG = { slug: 'mytix-e2e', name: 'MyTix E2E' };
const ANAN = 'anan@mytix.test';
const MALEE = 'malee@mytix.test';
const UPCOMING = 'mytix-upcoming-meetup';
const PAST = 'mytix-past-conf';

interface Success<T> {
  data: T;
}
interface Card {
  orderId: string;
  eventName: string;
  countdown: string | null;
  ticketCount: number;
  attended: boolean;
  eventSlug: string;
}
interface MyEvents {
  upcoming: Card[];
  past: Card[];
  counts: { upcoming: number; past: number };
}
interface Pass {
  id: string;
  reference: string;
  qrToken: string;
  status: string;
  valid: boolean;
  admissionNumber: string;
  eventName: string;
  seat: { number: string } | null;
}

describe('My tickets (e2e — US-DISC-07, US-DISC-09)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let anan: string;
  let malee: string;
  let ids: {
    orgId: number;
    upcomingEventId: string;
    freeTierId: string;
    myOrderId: string;
    myTicketIds: string[];
    myReference: string;
    pastCheckedInTicket: string;
    pastRefundedTicket: string;
    maleeTicket: string;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    const seeded = await seed(pool);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();
    server = app.getHttpServer() as Server;

    // ANAN's upcoming registration goes through the REAL checkout, as a guest —
    // it must surface in the portal purely because the email matches.
    const placed = await placeFreeOrder(
      server,
      seeded.upcomingEventId,
      seeded.freeTierId,
      ANAN,
    );
    ids = { ...seeded, ...placed };

    anan = await signIn(server, ANAN);
    malee = await signIn(server, MALEE);
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

  describe('US-DISC-09 — My Events', () => {
    it('splits my registrations into Upcoming and Past, with counts', async () => {
      const res = await get('/me/tickets', anan);
      expect(res.status).toBe(200);
      const me = (res.body as Success<MyEvents>).data;
      expect(me.counts).toEqual({ upcoming: 1, past: 1 });
      expect(me.upcoming[0].eventName).toBe('Upcoming Meetup');
      expect(me.past[0].eventName).toBe('Past Conf');
    });

    it('surfaces a guest purchase the moment the emails match', async () => {
      // The upcoming order was placed anonymously, before ANAN ever signed in.
      const me = ((await get('/me/tickets', anan)).body as Success<MyEvents>)
        .data;
      expect(me.upcoming[0].orderId).toBe(ids.myOrderId);
      expect(me.upcoming[0].ticketCount).toBe(2);
    });

    it('counts down to an upcoming event', async () => {
      const me = ((await get('/me/tickets', anan)).body as Success<MyEvents>)
        .data;
      expect(me.upcoming[0].countdown).toMatch(/days left|Today|Tomorrow/);
      expect(me.past[0].countdown).toBeNull();
    });

    it('marks a past event Attended once a ticket was scanned', async () => {
      const me = ((await get('/me/tickets', anan)).body as Success<MyEvents>)
        .data;
      expect(me.past[0].attended).toBe(true);
    });

    it('shows only MY registrations', async () => {
      const me = ((await get('/me/tickets', malee)).body as Success<MyEvents>)
        .data;
      // Malee holds one ticket on the upcoming event; Anan's orders are invisible.
      expect(me.counts).toEqual({ upcoming: 1, past: 0 });
      expect(me.upcoming[0].ticketCount).toBe(1);
    });

    it('gives a brand-new attendee a clean empty state', async () => {
      await pool.query(
        `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
         SELECT id, 'Fresh', 'fresh@mytix.test', 'attendee', 'Active', $1
         FROM organizations WHERE slug = 'eventa'`,
        [await hash(PASSWORD)],
      );
      const fresh = await signIn(server, 'fresh@mytix.test');
      const me = ((await get('/me/tickets', fresh)).body as Success<MyEvents>)
        .data;
      expect(me).toMatchObject({
        upcoming: [],
        past: [],
        counts: { upcoming: 0, past: 0 },
      });
    });

    it('requires a signed-in attendee', async () => {
      expect((await request(server).get('/api/v1/me/tickets')).status).toBe(
        401,
      );
    });
  });

  describe('US-DISC-07 — one ticket and its pass', () => {
    it('shows the QR, reference and admission number', async () => {
      const res = await get(`/me/tickets/${ids.myTicketIds[0]}`, anan);
      expect(res.status).toBe(200);
      const pass = (res.body as Success<Pass>).data;
      expect(pass.qrToken).toMatch(/^[0-9A-HJKMNP-TV-Z]{24}$/);
      expect(pass.reference).toBe(ids.myReference);
      expect(pass.admissionNumber).toMatch(/^[12] of 2$/);
      expect(pass.valid).toBe(true);
    });

    it('refuses a ticket that belongs to someone else', async () => {
      expect((await get(`/me/tickets/${ids.maleeTicket}`, anan)).status).toBe(
        404,
      );
      // …and the owner sees it fine.
      expect((await get(`/me/tickets/${ids.maleeTicket}`, malee)).status).toBe(
        200,
      );
    });

    it('shows a refunded ticket as no longer valid', async () => {
      const res = await get(`/me/tickets/${ids.pastRefundedTicket}`, anan);
      expect(res.status).toBe(200);
      const pass = (res.body as Success<Pass>).data;
      expect(pass.valid).toBe(false);
      expect(pass.status).toBe('refunded');
    });

    it('downloads a printable pass carrying the details', async () => {
      const res = await get(`/me/tickets/${ids.myTicketIds[0]}/pass.svg`, anan);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/image\/svg/);
      const svg = (res.body as Buffer).toString();
      expect(svg).toContain('Upcoming Meetup');
      expect(svg).toContain(ids.myReference);
      expect(svg).toContain('of 2');
    });

    it('will not print a refunded ticket as a valid pass', async () => {
      const res = await get(
        `/me/tickets/${ids.pastRefundedTicket}/pass.svg`,
        anan,
      );
      expect(res.status).toBe(409);
    });

    it('will not print someone else’s ticket at all', async () => {
      expect(
        (await get(`/me/tickets/${ids.maleeTicket}/pass.svg`, anan)).status,
      ).toBe(404);
    });

    it('still prints a checked-in ticket — scanned is not void', async () => {
      const res = await get(
        `/me/tickets/${ids.pastCheckedInTicket}/pass.svg`,
        anan,
      );
      expect(res.status).toBe(200);
    });
  });
});

async function signIn(server: Server, email: string): Promise<string> {
  const res = await request(server)
    .post('/api/v1/auth/login')
    .send({ email, password: PASSWORD, persona: 'attendee' });
  expect(res.status).toBe(200);
  return (res.body as Success<{ accessToken: string }>).data.accessToken;
}

async function placeFreeOrder(
  server: Server,
  eventId: string,
  ticketTypeId: string,
  buyerEmail: string,
): Promise<{ myOrderId: string; myTicketIds: string[]; myReference: string }> {
  const held = await request(server)
    .post('/api/v1/public/checkout/hold')
    .send({ eventId, ticketTypeId, quantity: 2 });
  expect(held.status).toBe(201);
  const res = await request(server)
    .post('/api/v1/public/checkout/confirm')
    .send({
      eventId,
      ticketTypeId,
      quantity: 2,
      holdIds: (held.body as Success<{ holdIds: number[] }>).data.holdIds,
      buyer: { name: 'Anan Suksawat', email: buyerEmail },
      idempotencyKey: `mytix-guest-${buyerEmail}`,
    });
  expect(res.status).toBe(201);
  const placed = (
    res.body as Success<{
      orderId: string;
      reference: string;
      tickets: { id: string }[];
    }>
  ).data;
  return {
    myOrderId: placed.orderId,
    myTicketIds: placed.tickets.map((t) => t.id),
    myReference: placed.reference,
  };
}

interface Seeded {
  orgId: number;
  upcomingEventId: string;
  freeTierId: string;
  pastCheckedInTicket: string;
  pastRefundedTicket: string;
  maleeTicket: string;
}

async function seed(pool: Pool): Promise<Seeded> {
  const org = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1,$2) RETURNING id`,
    [ORG.name, ORG.slug],
  );
  const orgId = Number(org.rows[0].id);
  const platform = await pool.query<{ id: string }>(
    `SELECT id FROM organizations WHERE slug = 'eventa'`,
  );
  const passwordHash = await hash(PASSWORD);
  for (const email of [ANAN, MALEE]) {
    await pool.query(
      `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
       VALUES ($1,'Attendee',$2,'attendee','Active',$3)`,
      [Number(platform.rows[0].id), email, passwordHash],
    );
  }

  const upcoming = await insertEvent(
    pool,
    orgId,
    UPCOMING,
    'Upcoming Meetup',
    30,
  );
  const freeTier = await insertTier(pool, orgId, upcoming, 'RSVP');
  const past = await insertEvent(pool, orgId, PAST, 'Past Conf', -30);
  const pastTier = await insertTier(pool, orgId, past, 'General');

  // ANAN's past registration: one scanned ticket, one refunded.
  const pastOrder = await insertOrder(
    pool,
    orgId,
    past,
    ANAN,
    'MYTIX-PAST-1',
    2,
  );
  const pastItem = await insertItem(pool, orgId, pastOrder, pastTier, 2);
  const pastCheckedInTicket = await insertTicket(
    pool,
    orgId,
    pastOrder,
    pastItem,
    past,
    pastTier,
    'checked_in',
  );
  const pastRefundedTicket = await insertTicket(
    pool,
    orgId,
    pastOrder,
    pastItem,
    past,
    pastTier,
    'refunded',
  );

  // MALEE's upcoming registration — must never appear in ANAN's portal.
  const maleeOrder = await insertOrder(
    pool,
    orgId,
    upcoming,
    MALEE,
    'MYTIX-MALEE-1',
    1,
  );
  const maleeItem = await insertItem(pool, orgId, maleeOrder, freeTier, 1);
  const maleeTicket = await insertTicket(
    pool,
    orgId,
    maleeOrder,
    maleeItem,
    upcoming,
    freeTier,
    'issued',
  );

  return {
    orgId,
    upcomingEventId: upcoming,
    freeTierId: freeTier,
    pastCheckedInTicket,
    pastRefundedTicket,
    maleeTicket,
  };
}

async function insertEvent(
  pool: Pool,
  orgId: number,
  slug: string,
  name: string,
  startsInDays: number,
): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO events (organization_id, slug, name, type, bucket, status, visibility,
                         start_at, end_at, timezone, organizer_name, venue_name, city, published_at)
     VALUES ($1,$2,$3,'Conference',$4,$5,'public',
             now() + ($6 || ' days')::interval,
             now() + ($6 || ' days')::interval + interval '6 hours',
             'Asia/Bangkok','Acme','QSNCC','Bangkok', now())
     RETURNING id`,
    [
      orgId,
      slug,
      name,
      startsInDays > 0 ? 'active' : 'completed',
      startsInDays > 0 ? 'upcoming' : 'completed',
      String(startsInDays),
    ],
  );
  return res.rows[0].id;
}

async function insertTier(
  pool: Pool,
  orgId: number,
  eventId: string,
  name: string,
): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO ticket_types (organization_id, event_id, name, price_satang, is_free,
                               status, total, sold, min_per_order, max_per_order)
     VALUES ($1,$2,$3,0,true,'onsale',100,0,1,8) RETURNING id`,
    [orgId, eventId, name],
  );
  return res.rows[0].id;
}

async function insertOrder(
  pool: Pool,
  orgId: number,
  eventId: string,
  email: string,
  reference: string,
  seats: number,
): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO orders (organization_id, reference, event_id, buyer_name, buyer_email,
                         status, payment_status, seats, subtotal_satang, total_satang)
     VALUES ($1,$2,$3,'Seeded',$4,'confirmed','paid',$5,0,0) RETURNING id`,
    [orgId, reference, eventId, email, seats],
  );
  return res.rows[0].id;
}

async function insertItem(
  pool: Pool,
  orgId: number,
  orderId: string,
  tierId: string,
  quantity: number,
): Promise<number> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO order_items (organization_id, order_id, ticket_type_id, quantity,
                              unit_price_satang, line_subtotal_satang)
     VALUES ($1,$2,$3,$4,0,0) RETURNING id`,
    [orgId, orderId, tierId, quantity],
  );
  return Number(res.rows[0].id);
}

let ticketSeq = 0;

async function insertTicket(
  pool: Pool,
  orgId: number,
  orderId: string,
  orderItemId: number,
  eventId: string,
  tierId: string,
  status: string,
): Promise<string> {
  ticketSeq += 1;
  const res = await pool.query<{ id: string }>(
    `INSERT INTO tickets (organization_id, order_id, order_item_id, event_id,
                          ticket_type_id, qr_token, holder_name, ticket_label, status,
                          checked_in_at)
     VALUES ($1,$2,$3,$4,$5,$6,'Seeded','General',$7::issued_ticket_status,
             CASE WHEN $7::text = 'checked_in' THEN now() ELSE NULL END)
     RETURNING id`,
    [
      orgId,
      orderId,
      orderItemId,
      eventId,
      tierId,
      `MYTIXSEED${ticketSeq}X`,
      status,
    ],
  );
  return res.rows[0].id;
}

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM outbox_events WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug = $1)`,
    [ORG.slug],
  );
  await pool.query(
    `DELETE FROM outbox_events WHERE aggregate_id IN
       (SELECT id::text FROM users WHERE email LIKE '%@mytix.test')`,
  );
  await pool.query(`DELETE FROM users WHERE email LIKE '%@mytix.test'`);
  await pool.query(`DELETE FROM organizations WHERE slug = $1`, [ORG.slug]);
}
