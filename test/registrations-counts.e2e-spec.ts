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
import { orderStatusEnum } from '../src/db/schema';
import { listenOnLoopback } from './support/loopback';

const PASSWORD = 'correct horse battery staple';
const ORG = { slug: 'regcount-e2e', name: 'Registration Counts E2E' };
const ADMIN = 'admin@regcount-e2e.test';

/** One order per status, so the queue holds every member of the enum exactly once. */
const SEEDED = orderStatusEnum.enumValues;

interface Success<T> {
  data: T;
}
interface Entry {
  reference: string;
  status: string;
}
type Counts = Record<string, number> & { all: number };

/**
 * The registrations queue's tab totals (US-REG-01).
 *
 * The rule under test is not "each bucket is right" but the invariant between
 * the All pill and the table: whatever the `order_status` enum holds, All is
 * the number of rows the same request lists. It is an e2e because the count
 * and the page are two queries over one predicate, and only the database can
 * say they agree.
 */
describe('Registrations queue counts (e2e — US-REG-01)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let orgId: number;
  let jwt: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    orgId = await seedOrg(pool, ORG, ADMIN);
    await seedQueue(pool, orgId);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await listenOnLoopback(app);
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
      .get(`/api/v1/registrations${query}`)
      .set('Authorization', `Bearer ${jwt}`);

  const body = (res: { body: unknown }) =>
    res.body as Success<Entry[]> & {
      meta: { counts: Counts; total: number };
    };

  it('counts exactly the rows it lists, so All can never read smaller than the table', async () => {
    // The defect: `expired` was listed but in no bucket, and All was the sum of
    // five buckets, so the pill read one short of its own table.
    const { meta } = body(await list());
    expect(meta.counts.all).toBe(meta.total);
    expect(meta.total).toBe(SEEDED.length);
  });

  it('publishes a bucket for every status the column can hold', async () => {
    const { counts } = body(await list()).meta;
    for (const status of SEEDED) {
      expect(counts[status]).toBe(1);
    }
  });

  it('counts an expired registration, which has no tab of its own', async () => {
    expect(body(await list()).meta.counts.expired).toBe(1);
  });

  it('agrees with its own breakdown while every status has a field', async () => {
    // Not how All is computed — it is counted, not summed — but while the DTO
    // publishes a field per enum member the two must come to the same number.
    // This is the assertion that fails first if the enum grows and the DTO does
    // not: the remainder has nowhere to be reported.
    const { counts } = body(await list()).meta;
    const summed = SEEDED.reduce((total, s) => total + counts[s], 0);
    expect(summed).toBe(counts.all);
  });

  it('serves a status with no pill, because the DTO accepts every member', async () => {
    // The console reaches expired rows only under All (see `REG_TABS`); that is
    // a choice about the pills, not a limit of the API, and this pins it so a
    // future tab needs no server change.
    const res = await list('?status=expired');
    expect(res.status).toBe(200);
    expect(body(res).data).toHaveLength(1);
    expect(body(res).data[0].status).toBe('expired');
  });

  it('keeps the counts describing the whole queue while the list is narrowed', async () => {
    // Page 2 of Pending still has to say how many are Confirmed, so the status
    // filter is dropped from the counts — and only the status.
    const { meta, data } = body(await list('?status=pending'));
    expect(data).toHaveLength(1);
    expect(meta.total).toBe(1);
    expect(meta.counts.all).toBe(SEEDED.length);
  });

  it('narrows the counts by a filter that also narrows the list', async () => {
    // A search that matches nothing must take the counts down with the rows,
    // or All describes a queue that is not on screen. Unlike the status, every
    // other narrowing reaches the counts.
    const { meta, data } = body(
      await list(`?search=${encodeURIComponent('nobody-at-all')}`),
    );
    expect(data).toEqual([]);
    expect(meta.counts.all).toBe(0);
  });
});

/** One order in each status, all free, so no payment rows are needed. */
async function seedQueue(pool: Pool, orgId: number): Promise<void> {
  const ev = await pool.query<{ id: string }>(
    `INSERT INTO events (organization_id, slug, name, type, bucket, status, visibility,
                         start_at, timezone, organizer_name, venue_name, city, published_at)
     VALUES ($1,'regcount-summit','Counts Summit','Conference','active','live','public',
             now(),'Asia/Bangkok','Acme','QSNCC','Bangkok', now()) RETURNING id`,
    [orgId],
  );
  const eventId = ev.rows[0].id;
  const tier = await pool.query<{ id: string }>(
    `INSERT INTO ticket_types (organization_id, event_id, name, price_satang,
                               status, total, sold, min_per_order, max_per_order)
     VALUES ($1,$2,'General',0,'onsale',100,0,1,8) RETURNING id`,
    [orgId, eventId],
  );
  let n = 0;
  for (const status of SEEDED) {
    n += 1;
    const order = await pool.query<{ id: string }>(
      `INSERT INTO orders (organization_id, reference, event_id, buyer_name, buyer_email,
                           status, payment_status, seats, subtotal_satang, total_satang)
       VALUES ($1,$2,$3,$4,$5,$6,'pending',1,0,0) RETURNING id`,
      [
        orgId,
        `ORD-RC-${n}`,
        eventId,
        `Buyer ${status}`,
        `${status}@regcount.test`,
        status,
      ],
    );
    await pool.query(
      `INSERT INTO order_items (organization_id, order_id, ticket_type_id, quantity,
                                unit_price_satang, line_subtotal_satang)
       VALUES ($1,$2,$3,1,0,0)`,
      [orgId, order.rows[0].id, tier.rows[0].id],
    );
  }
}

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
  // `is_system` defaults to TRUE, and sign-in reconciles a built-in role named
  // Admin up to the full grant set that name carries — which would widen the
  // single grant this fixture holds on purpose. This role is the spec's own.
  const role = await pool.query<{ id: string }>(
    `INSERT INTO roles (organization_id, name, description, is_system) VALUES ($1,'Admin','seed',false) RETURNING id`,
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
  const slugs = [ORG.slug];
  const scoped = `organization_id IN
       (SELECT id FROM organizations WHERE slug = ANY($1))`;
  // Order matters: tickets and check_ins hold ON DELETE RESTRICT references to
  // events, and audit_events leads because a failed login writes one — the
  // organizations delete below fails unless it is cleared first.
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
