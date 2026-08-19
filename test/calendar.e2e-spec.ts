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
const ORG = { slug: 'cal-e2e', name: 'Calendar E2E' };
const ADMIN = 'admin@cal-e2e.test'; // evCreate
const LIMITED = 'staff@cal-e2e.test'; // regView only

interface Success<T> {
  data: T;
}
interface CalEvent {
  id: string;
  name: string;
}
interface Calendar {
  month: string;
  count: number;
  events: CalEvent[];
}
interface Upcoming {
  id: string;
  name: string;
  daysLeft: number;
  sold: number;
  capacity: number;
  fillPercent: number;
}

describe('Calendar & upcoming (e2e — US-EVT-12)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let adminJwt: string;

  const auth = (jwt: string) => ({ Authorization: `Bearer ${jwt}` });

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    await seedOrg(pool, ORG, [
      { email: ADMIN, roleName: 'Admin', grants: ['evCreate'] },
      { email: LIMITED, roleName: 'Organizer', grants: ['regView'] },
    ]);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();
    server = app.getHttpServer() as Server;

    adminJwt = await token(ADMIN, ORG.slug);
    // Calendar fixtures (absolute months).
    await createEvent('Sep Mid', '2026-09-15T02:00:00Z');
    // Bangkok +7: 2026-08-31T17:00Z == 2026-09-01T00:00 Bangkok → counts as September.
    await createEvent('Sep Boundary', '2026-08-31T17:00:00Z');
    await createEvent('Oct Event', '2026-10-05T02:00:00Z');
    // Upcoming fixtures (far future so they're future regardless of wall-clock).
    const soon = await createEvent('Soon 2030', '2030-01-01T00:00:00Z');
    const ticket = await request(server)
      .post(`/api/v1/events/${soon}/tickets`)
      .set(auth(adminJwt))
      .send({ name: 'GA', priceSatang: 10000, total: 200 });
    await pool.query(`UPDATE ticket_types SET sold = 40 WHERE id = $1`, [
      (ticket.body as Success<{ id: string }>).data.id,
    ]);
    await createEvent('Far 2030', '2030-06-01T00:00:00Z');
    await createEvent('Past 2020', '2020-01-01T00:00:00Z');
  }, 30000);

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  const token = async (email: string, orgSlug: string) => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, orgSlug, persona: 'admin' });
    return (res.body as Success<{ accessToken: string }>).data.accessToken;
  };

  async function createEvent(name: string, startAt: string): Promise<string> {
    const res = await request(server)
      .post('/api/v1/events')
      .set(auth(adminJwt))
      .send({ name, type: 'Conference', startAt });
    return (res.body as Success<{ id: string }>).data.id;
  }

  it('lists a month’s events with the count, honouring Bangkok boundaries', async () => {
    const res = await request(server)
      .get('/api/v1/events/calendar?month=2026-09')
      .set(auth(adminJwt));
    expect(res.status).toBe(200);
    const cal = (res.body as Success<Calendar>).data;
    expect(cal.month).toBe('2026-09');
    const names = cal.events.map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(['Sep Mid', 'Sep Boundary']));
    expect(names).not.toContain('Oct Event');
    expect(cal.count).toBe(2);
  });

  it('keeps the Bangkok-midnight boundary event OUT of the prior month', async () => {
    const res = await request(server)
      .get('/api/v1/events/calendar?month=2026-08')
      .set(auth(adminJwt));
    const cal = (res.body as Success<Calendar>).data;
    expect(cal.events.map((e) => e.name)).not.toContain('Sep Boundary');
  });

  it('lists upcoming events soonest-first with days-left and fill %', async () => {
    const res = await request(server)
      .get('/api/v1/events/upcoming')
      .set(auth(adminJwt));
    expect(res.status).toBe(200);
    const rows = (res.body as Success<Upcoming[]>).data;
    const names = rows.map((r) => r.name);

    expect(names).not.toContain('Past 2020'); // past excluded
    const soonIdx = names.indexOf('Soon 2030');
    const farIdx = names.indexOf('Far 2030');
    expect(soonIdx).toBeGreaterThanOrEqual(0);
    expect(farIdx).toBeGreaterThan(soonIdx); // soonest first

    const soon = rows[soonIdx];
    expect(soon.daysLeft).toBeGreaterThan(0);
    expect(soon).toMatchObject({ sold: 40, capacity: 200, fillPercent: 20 });
  });

  it('forbids the calendar without evCreate (403)', async () => {
    const limitedJwt = await token(LIMITED, ORG.slug);
    await request(server)
      .get('/api/v1/events/calendar?month=2026-09')
      .set(auth(limitedJwt))
      .expect(403);
  });
});

const PERM_GROUP: Record<string, string> = {
  evCreate: 'Events',
  regView: 'Registrations',
};

async function seedOrg(
  pool: Pool,
  org: { slug: string; name: string },
  people: { email: string; roleName: string; grants: string[] }[],
): Promise<void> {
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
}

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM audit_events WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug = $1)`,
    [ORG.slug],
  );
  await pool.query(`DELETE FROM organizations WHERE slug = $1`, [ORG.slug]);
}
