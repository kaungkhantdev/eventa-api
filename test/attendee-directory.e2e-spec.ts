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
const ORG = { slug: 'dir-e2e', name: 'Directory E2E' };
const ORG2 = { slug: 'dir-e2e-2', name: 'Directory E2E 2' };
const ADMIN = 'admin@dir-e2e.test';
const ADMIN2 = 'admin@dir-e2e-2.test';

interface Success<T> {
  data: T;
}
interface Attendee {
  id: number;
  name: string;
  email: string;
  tag: string | null;
  eventCount: number;
  ticketCount: number;
  checkedInCount: number;
}
interface Counts {
  all: number;
  new: number;
  checkedIn: number;
  vip: number;
}

describe('Attendee directory (e2e — US-REG-05)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let orgId: number;
  let jwt: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    orgId = await seedOrg(pool, ORG, ADMIN);
    await seedOrg(pool, ORG2, ADMIN2);
    await seedEvent(pool, orgId, 'dir-summit');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();
    server = app.getHttpServer() as Server;
    jwt = await token(ADMIN, ORG.slug);
  }, 30000);

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

  const list = (query = '') =>
    request(server)
      .get(`/api/v1/attendees${query}`)
      .set('Authorization', `Bearer ${jwt}`);

  const body = (res: { body: unknown }) =>
    res.body as Success<Attendee[]> & { meta: { counts: Counts } };

  it('lists attendees with their event, ticket and check-in counts', async () => {
    const res = await list();
    expect(res.status).toBe(200);
    const anan = body(res).data.find((a) => a.email === 'anan@dir.test');
    expect(anan).toBeDefined();
    expect(anan?.eventCount).toBe(1);
    expect(anan?.ticketCount).toBe(2);
    // One of the two tickets was used at the door.
    expect(anan?.checkedInCount).toBe(1);
  });

  it('counts each segment across the WHOLE directory', async () => {
    const counts = body(await list()).meta.counts;
    expect(counts.all).toBe(3);
    expect(counts.vip).toBe(1);
    expect(counts.checkedIn).toBe(1);
    // All three were seeded just now, so all are "new".
    expect(counts.new).toBe(3);
  });

  it('narrows to a segment while the counts still describe everything', async () => {
    const res = await list('?segment=vip');
    expect(body(res).data).toHaveLength(1);
    expect(body(res).data[0].tag).toBe('VIP');
    expect(body(res).meta.counts.all).toBe(3);
  });

  it('filters by tag', async () => {
    expect(body(await list('?tag=Speaker')).data).toHaveLength(1);
  });

  it('searches by name and by email', async () => {
    expect(body(await list('?search=Malee')).data).toHaveLength(1);
    expect(body(await list('?search=anan@dir')).data).toHaveLength(1);
  });

  it('returns an empty page rather than an error when nothing matches', async () => {
    const res = await list('?search=nobodyatall');
    expect(res.status).toBe(200);
    expect(body(res).data).toEqual([]);
    expect(body(res).meta.total).toBe(0);
  });

  it('sorts by name, and by most tickets', async () => {
    const byName = body(await list('?sort=name')).data.map((a) => a.name);
    expect(byName).toEqual([...byName].sort());
    const byTickets = body(await list('?sort=tickets')).data;
    expect(byTickets[0].email).toBe('anan@dir.test');
  });

  it('never shows another workspace its attendees', async () => {
    const other = await token(ADMIN2, ORG2.slug);
    const res = await request(server)
      .get('/api/v1/attendees')
      .set('Authorization', `Bearer ${other}`);
    expect((res.body as Success<Attendee[]>).data).toEqual([]);
  });

  it('refuses an unauthenticated caller', async () => {
    expect((await request(server).get('/api/v1/attendees')).status).toBe(401);
  });

  async function seedEvent(
    pool: Pool,
    orgId: number,
    slug: string,
  ): Promise<string> {
    const ev = await pool.query<{ id: string }>(
      `INSERT INTO events (organization_id, slug, name, type, bucket, status, visibility,
                           start_at, timezone, organizer_name, venue_name, city, published_at)
       VALUES ($1,$2,'Directory Summit','Conference','active','live','public',
               now(),'Asia/Bangkok','Acme','QSNCC','Bangkok', now()) RETURNING id`,
      [orgId, slug],
    );
    const eventId = ev.rows[0].id;
    const tier = await pool.query<{ id: string }>(
      `INSERT INTO ticket_types (organization_id, event_id, name, price_satang,
                                 status, total, sold, min_per_order, max_per_order)
       VALUES ($1,$2,'General',0,'onsale',100,0,1,8) RETURNING id`,
      [orgId, eventId],
    );

    const people = [
      { name: 'Anan Suksawat', email: 'anan@dir.test', tag: 'VIP', tickets: 2 },
      {
        name: 'Malee Chai',
        email: 'malee@dir.test',
        tag: 'Speaker',
        tickets: 1,
      },
      {
        name: 'Somchai Wong',
        email: 'somchai@dir.test',
        tag: null,
        tickets: 0,
      },
    ];
    let n = 0;
    for (const p of people) {
      n += 1;
      const att = await pool.query<{ id: string }>(
        `INSERT INTO attendees (organization_id, name, email, tag)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [orgId, p.name, p.email, p.tag],
      );
      if (p.tickets === 0) continue;
      const order = await pool.query<{ id: string }>(
        `INSERT INTO orders (organization_id, reference, event_id, attendee_id, buyer_name,
                             buyer_email, status, payment_status, seats, subtotal_satang, total_satang)
         VALUES ($1,$2,$3,$4,$5,$6,'confirmed','paid',$7,0,0) RETURNING id`,
        [
          orgId,
          `ORD-DIR-${n}`,
          eventId,
          att.rows[0].id,
          p.name,
          p.email,
          p.tickets,
        ],
      );
      const item = await pool.query<{ id: string }>(
        `INSERT INTO order_items (organization_id, order_id, ticket_type_id, quantity,
                                  unit_price_satang, line_subtotal_satang)
         VALUES ($1,$2,$3,$4,0,0) RETURNING id`,
        [orgId, order.rows[0].id, tier.rows[0].id, p.tickets],
      );
      for (let i = 0; i < p.tickets; i += 1) {
        // Anan's first ticket was used at the door; everything else is unused.
        const used = p.email === 'anan@dir.test' && i === 0;
        await pool.query(
          `INSERT INTO tickets (organization_id, order_id, order_item_id, event_id,
                                ticket_type_id, qr_token, holder_name, status, checked_in_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            orgId,
            order.rows[0].id,
            item.rows[0].id,
            eventId,
            tier.rows[0].id,
            `qr-dir-${n}-${i}`,
            p.name,
            used ? 'checked_in' : 'issued',
            used ? new Date() : null,
          ],
        );
      }
    }
    return eventId;
  }
});

async function seedOrg(
  pool: Pool,
  org: { slug: string; name: string },
  email: string,
): Promise<number> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
    [org.name, org.slug],
  );
  const orgId = Number(res.rows[0].id);
  await pool.query(
    `INSERT INTO permissions (key, "group", label) VALUES ('regView','Registrations','regView')
     ON CONFLICT (key) DO NOTHING`,
  );
  const role = await pool.query<{ id: string }>(
    `INSERT INTO roles (organization_id, name, description) VALUES ($1,'Admin','seed') RETURNING id`,
    [orgId],
  );
  await pool.query(
    `INSERT INTO role_permissions (role_id, permission_key, granted) VALUES ($1,'regView',true)`,
    [Number(role.rows[0].id)],
  );
  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
     VALUES ($1,'Seed',$2,'admin','Active',$3) RETURNING id`,
    [orgId, email, await hash(PASSWORD)],
  );
  await pool.query(
    `INSERT INTO memberships (organization_id, user_id, role_id, role, status)
     VALUES ($1,$2,$3,'Admin','Active')`,
    [orgId, user.rows[0].id, Number(role.rows[0].id)],
  );
  return orgId;
}

async function cleanup(pool: Pool): Promise<void> {
  const slugs = [ORG.slug, ORG2.slug];
  const scoped = `organization_id IN
       (SELECT id FROM organizations WHERE slug = ANY($1))`;
  // Order matters: check_ins and tickets hold ON DELETE RESTRICT references to
  // events, deliberately — admission history outlives the event it belongs to.
  for (const table of [
    'audit_events',
    'check_ins',
    'tickets',
    'order_items',
    'orders',
    'ticket_types',
    'attendees',
    'events',
  ]) {
    await pool.query(`DELETE FROM ${table} WHERE ${scoped}`, [slugs]);
  }
  await pool.query(`DELETE FROM organizations WHERE slug = ANY($1)`, [slugs]);
}
