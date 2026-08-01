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
const ORG = { slug: 'evt-list-e2e', name: 'Events List E2E' };
const ADMIN = 'admin@evt-list-e2e.test';

interface SuccessBody<T> {
  success: boolean;
  data: T;
  meta?: { page: number; limit: number; total: number; totalPages: number };
}
interface ListItem {
  id: string;
  name: string;
  registrations: number;
  fillPercent: number;
  capacity: number | null;
}

describe('Events list — registrations fill, sort & summary (US-EVT-01, e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let orgId: number;
  let jwt: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    orgId = await seedTenant(pool);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();
    server = app.getHttpServer() as Server;

    jwt = await login();
    ids.full = await createEvent('Full Fest');
    ids.half = await createEvent('Half House');
    ids.empty = await createEvent('Empty Hall');

    // Half House carries an explicit capacity (200) — capacity wins over Σ quantity.
    await patchCapacity(ids.half, 200);

    // 90 sold of a 100 allocation (no event capacity → Σ quantity is the cap → 90%).
    await seedTicketType(ids.full, { total: 100, sold: 90 });
    // 50 sold of a 100 allocation but capacity is 200 → 25% fill.
    await seedTicketType(ids.half, { total: 100, sold: 50 });
    // Empty Hall gets no ticket types → 0 registrations, 0% fill.
  });

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  const login = async (): Promise<string> => {
    const res = await request(server).post('/api/v1/auth/login').send({
      email: ADMIN,
      password: PASSWORD,
      orgSlug: ORG.slug,
      persona: 'admin',
    });
    return (res.body as SuccessBody<{ accessToken: string }>).data.accessToken;
  };

  const createEvent = async (name: string): Promise<string> => {
    const res = await request(server)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${jwt}`)
      .send({ name, type: 'Conference', startAt: '2026-09-01T02:00:00Z' });
    return (res.body as SuccessBody<{ id: string }>).data.id;
  };

  const patchCapacity = (eventId: string, capacity: number) =>
    request(server)
      .patch(`/api/v1/events/${eventId}`)
      .set('Authorization', `Bearer ${jwt}`)
      .send({ capacity });

  const list = (query = '') =>
    request(server)
      .get(`/api/v1/events${query}`)
      .set('Authorization', `Bearer ${jwt}`);

  it('folds registrations and fillPercent into each list row', async () => {
    const res = await list();
    expect(res.status).toBe(200);
    const rows = (res.body as SuccessBody<ListItem[]>).data;

    const full = rows.find((r) => r.id === ids.full);
    expect(full).toMatchObject({ registrations: 90, fillPercent: 90 });

    const half = rows.find((r) => r.id === ids.half);
    // capacity 200 takes precedence over the 100-ticket allocation → 25%.
    expect(half).toMatchObject({ registrations: 50, fillPercent: 25 });

    const empty = rows.find((r) => r.id === ids.empty);
    expect(empty).toMatchObject({ registrations: 0, fillPercent: 0 });
  });

  it('sorts by registrations, fullest first', async () => {
    const res = await list('?sort=registrations');
    expect(res.status).toBe(200);
    const rows = (res.body as SuccessBody<ListItem[]>).data;
    const order = rows.map((r) => r.id);
    // Full (90) before Half (50) before Empty (0).
    expect(order.indexOf(ids.full)).toBeLessThan(order.indexOf(ids.half));
    expect(order.indexOf(ids.half)).toBeLessThan(order.indexOf(ids.empty));
  });

  it('paginates a registrations-sorted result set', async () => {
    const res = await list('?sort=registrations&page=1&limit=1');
    expect(res.status).toBe(200);
    const body = res.body as SuccessBody<ListItem[]>;
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(ids.full);
    expect(body.meta).toMatchObject({
      page: 1,
      limit: 1,
      total: 3,
      totalPages: 3,
    });
  });

  it('exposes Active/Completed bucket counts via /events/summary', async () => {
    const res = await request(server)
      .get('/api/v1/events/summary')
      .set('Authorization', `Bearer ${jwt}`);
    expect(res.status).toBe(200);
    expect((res.body as SuccessBody<unknown>).data).toEqual({
      active: 3,
      completed: 0,
    });
  });

  const seedTicketType = (
    eventId: string,
    t: { total: number; sold: number },
  ) =>
    pool.query(
      `INSERT INTO ticket_types (organization_id, event_id, name, total, sold, status)
       VALUES ($1, $2, 'General', $3, $4, 'onsale')`,
      [orgId, eventId, t.total, t.sold],
    );

  async function seedTenant(db: Pool): Promise<number> {
    const org = await db.query<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
      [ORG.name, ORG.slug],
    );
    const id = Number(org.rows[0].id);
    const passwordHash = await hash(PASSWORD);
    const user = await db.query<{ id: string }>(
      `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
       VALUES ($1, 'Seed Admin', $2, 'admin', 'Active', $3) RETURNING id`,
      [id, ADMIN, passwordHash],
    );
    await db.query(
      `INSERT INTO permissions (key, "group", label) VALUES ('evCreate', 'Events', 'evCreate')
       ON CONFLICT (key) DO NOTHING`,
    );
    const role = await db.query<{ id: string }>(
      `INSERT INTO roles (organization_id, name, description) VALUES ($1, 'Admin', 'seed') RETURNING id`,
      [id],
    );
    const roleId = Number(role.rows[0].id);
    await db.query(
      `INSERT INTO role_permissions (role_id, permission_key, granted) VALUES ($1, 'evCreate', true)`,
      [roleId],
    );
    await db.query(
      `INSERT INTO memberships (organization_id, user_id, role_id, role, status)
       VALUES ($1, $2, $3, 'Admin', 'Active')`,
      [id, user.rows[0].id, roleId],
    );
    return id;
  }
});

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(`DELETE FROM organizations WHERE slug = $1`, [ORG.slug]);
}
