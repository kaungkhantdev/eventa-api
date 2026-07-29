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
const ORG = { slug: 'tkt-e2e', name: 'Ticketing E2E' };
const ORG2 = { slug: 'tkt-e2e-2', name: 'Ticketing E2E 2' };
const ADMIN = 'admin@tkt-e2e.test';
const LIMITED = 'staff@tkt-e2e.test';
const ADMIN2 = 'admin@tkt-e2e-2.test';

interface Success<T> {
  data: T;
}
interface Ticket {
  id: string;
  name: string;
  isFree: boolean;
  priceSatang: number;
  netSatang: number;
  vatSatang: number;
  total: number;
}

describe('Ticket types (e2e — US-EVT-06)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let eventId: string;
  let foreignEventId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    await seedOrg(pool, ORG, [
      { email: ADMIN, roleName: 'Admin', grants: ['evCreate'] },
      { email: LIMITED, roleName: 'Staff', grants: ['regView'] },
    ]);
    await seedOrg(pool, ORG2, [
      { email: ADMIN2, roleName: 'Admin', grants: ['evCreate'] },
    ]);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();
    server = app.getHttpServer() as Server;

    eventId = await createEvent(await token(ADMIN, ORG.slug), 'Ticketed Event');
    foreignEventId = await createEvent(await token(ADMIN2, ORG2.slug), 'Other');
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

  async function createEvent(jwt: string, name: string): Promise<string> {
    const res = await request(server)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${jwt}`)
      .send({ name, type: 'Conference', startAt: '2026-09-01T02:00:00Z' });
    return (res.body as Success<{ id: string }>).data.id;
  }

  const createTicket = (jwt: string, body: Record<string, unknown>) =>
    request(server)
      .post(`/api/v1/events/${eventId}/tickets`)
      .set('Authorization', `Bearer ${jwt}`)
      .send(body);

  it('creates a paid tier and returns the VAT-inclusive breakdown (฿890)', async () => {
    const jwt = await token(ADMIN, ORG.slug);
    const res = await createTicket(jwt, {
      name: 'VIP',
      priceSatang: 89000,
      total: 100,
    });
    expect(res.status).toBe(201);
    const t = (res.body as Success<Ticket>).data;
    expect(t).toMatchObject({
      priceSatang: 89000,
      netSatang: 83178,
      vatSatang: 5822,
    });
  });

  it('forces price to 0 for a free tier', async () => {
    const jwt = await token(ADMIN, ORG.slug);
    const res = await createTicket(jwt, {
      name: 'Free',
      isFree: true,
      priceSatang: 5000,
      total: 50,
    });
    expect(res.status).toBe(201);
    expect((res.body as Success<Ticket>).data.priceSatang).toBe(0);
  });

  it('rejects a duplicate tier name with 409', async () => {
    const jwt = await token(ADMIN, ORG.slug);
    expect((await createTicket(jwt, { name: 'VIP' })).status).toBe(409);
  });

  it('lists the tiers for the event', async () => {
    const jwt = await token(ADMIN, ORG.slug);
    const res = await request(server)
      .get(`/api/v1/events/${eventId}/tickets`)
      .set('Authorization', `Bearer ${jwt}`);
    expect(res.status).toBe(200);
    const names = (res.body as Success<Ticket[]>).data.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['VIP', 'Free']));
  });

  it('rejects lowering total below what has already sold (422)', async () => {
    const jwt = await token(ADMIN, ORG.slug);
    const created = await createTicket(jwt, { name: 'Early Bird', total: 100 });
    const ticketId = (created.body as Success<Ticket>).data.id;
    await pool.query(`UPDATE ticket_types SET sold = 10 WHERE id = $1`, [
      ticketId,
    ]);

    const res = await request(server)
      .patch(`/api/v1/events/${eventId}/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${jwt}`)
      .send({ total: 5 });
    expect(res.status).toBe(422);
  });

  it('forbids adding a ticket to another tenant’s event (404)', async () => {
    const jwt = await token(ADMIN, ORG.slug);
    const res = await request(server)
      .post(`/api/v1/events/${foreignEventId}/tickets`)
      .set('Authorization', `Bearer ${jwt}`)
      .send({ name: 'Sneaky', priceSatang: 100 });
    expect(res.status).toBe(404);
  });

  it('forbids a user without evCreate (403)', async () => {
    const jwt = await token(LIMITED, ORG.slug);
    expect((await createTicket(jwt, { name: 'Nope' })).status).toBe(403);
  });

  it('refuses to delete the last remaining tier but allows others', async () => {
    const jwt = await token(ADMIN, ORG.slug);
    // Make a fresh event with a single tier.
    const solo = await createEvent(jwt, 'Solo Tier Event');
    const only = await request(server)
      .post(`/api/v1/events/${solo}/tickets`)
      .set('Authorization', `Bearer ${jwt}`)
      .send({ name: 'General', priceSatang: 10000 });
    const onlyId = (only.body as Success<Ticket>).data.id;

    await request(server)
      .delete(`/api/v1/events/${solo}/tickets/${onlyId}`)
      .set('Authorization', `Bearer ${jwt}`)
      .expect(422);

    // Add a second, then the first can be removed.
    await request(server)
      .post(`/api/v1/events/${solo}/tickets`)
      .set('Authorization', `Bearer ${jwt}`)
      .send({ name: 'VIP', priceSatang: 50000 })
      .expect(201);
    await request(server)
      .delete(`/api/v1/events/${solo}/tickets/${onlyId}`)
      .set('Authorization', `Bearer ${jwt}`)
      .expect(200);
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
  const slugs = [ORG.slug, ORG2.slug];
  await pool.query(
    `DELETE FROM audit_events WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug = ANY($1))`,
    [slugs],
  );
  await pool.query(`DELETE FROM organizations WHERE slug = ANY($1)`, [slugs]);
}
