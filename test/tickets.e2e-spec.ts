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
  status: string;
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

  it('US-TKT-01: a future sales start is Scheduled, an open window is On sale', async () => {
    const jwt = await token(ADMIN, ORG.slug);
    const later = await createTicket(jwt, {
      name: 'Early access',
      priceSatang: 50000,
      total: 100,
      salesStartAt: '2030-01-01T00:00:00Z',
    });
    expect((later.body as Success<Ticket>).data.status).toBe('scheduled');

    const now = await createTicket(jwt, {
      name: 'Doors open',
      priceSatang: 50000,
      total: 100,
      salesStartAt: '2020-01-01T00:00:00Z',
    });
    expect((now.body as Success<Ticket>).data.status).toBe('onsale');
  });

  it('US-TKT-01: refuses a sales end before the start, and an oversized per-order limit', async () => {
    const jwt = await token(ADMIN, ORG.slug);
    const backwards = await createTicket(jwt, {
      name: 'Backwards',
      total: 10,
      salesStartAt: '2030-02-01T00:00:00Z',
      salesEndAt: '2030-01-01T00:00:00Z',
    });
    expect(backwards.status).toBe(422);

    const tooMany = await createTicket(jwt, {
      name: 'Too generous',
      total: 5,
      maxPerOrder: 8,
    });
    expect(tooMany.status).toBe(422);
  });

  it('US-TKT-02: price is frozen once a seat has sold, but capacity may still grow', async () => {
    const jwt = await token(ADMIN, ORG.slug);
    const created = await createTicket(jwt, {
      name: 'Locked tier',
      priceSatang: 100000,
      total: 100,
    });
    const id = (created.body as Success<Ticket>).data.id;
    await pool.query(
      `UPDATE ticket_types SET sold = 640, total = 700 WHERE id = $1`,
      [id],
    );

    const patch = (body: Record<string, unknown>) =>
      request(server)
        .patch(`/api/v1/events/${eventId}/tickets/${id}`)
        .set('Authorization', `Bearer ${jwt}`)
        .send(body);

    const repriced = await patch({ priceSatang: 50000 });
    expect(repriced.status).toBe(409);
    expect((repriced.body as { message: string }).message).toMatch(
      /new ticket type/i,
    );
    expect((await patch({ isFree: true })).status).toBe(409);

    // …and the money never moved.
    const { rows } = await pool.query<{ price_satang: string }>(
      `SELECT price_satang FROM ticket_types WHERE id = $1`,
      [id],
    );
    expect(Number(rows[0].price_satang)).toBe(100000);

    const grown = await patch({ total: 900 });
    expect(grown.status).toBe(200);
    expect((grown.body as Success<Ticket>).data.status).toBe('onsale');
  });

  it('US-TKT-02: raising capacity brings a sold-out tier back On sale', async () => {
    const jwt = await token(ADMIN, ORG.slug);
    const created = await createTicket(jwt, {
      name: 'Sold out tier',
      total: 10,
    });
    const id = (created.body as Success<Ticket>).data.id;
    await pool.query(
      `UPDATE ticket_types SET sold = 10, status = 'soldout' WHERE id = $1`,
      [id],
    );
    const res = await request(server)
      .patch(`/api/v1/events/${eventId}/tickets/${id}`)
      .set('Authorization', `Bearer ${jwt}`)
      .send({ total: 25 });
    expect((res.body as Success<Ticket>).data.status).toBe('onsale');
  });

  it('US-TKT-03: pause stops sales inside the window, resume brings them back', async () => {
    const jwt = await token(ADMIN, ORG.slug);
    const created = await createTicket(jwt, {
      name: 'Pausable',
      priceSatang: 20000,
      total: 50,
      salesStartAt: '2020-01-01T00:00:00Z',
    });
    const id = (created.body as Success<Ticket>).data.id;
    const call = (action: string) =>
      request(server)
        .post(`/api/v1/events/${eventId}/tickets/${id}/${action}`)
        .set('Authorization', `Bearer ${jwt}`);

    const paused = await call('pause');
    expect(paused.status).toBe(200);
    expect((paused.body as Success<Ticket>).data.status).toBe('paused');

    // a paused tier survives an unrelated edit — only Resume lifts it
    const edited = await request(server)
      .patch(`/api/v1/events/${eventId}/tickets/${id}`)
      .set('Authorization', `Bearer ${jwt}`)
      .send({ name: 'Pausable (renamed)' });
    expect((edited.body as Success<Ticket>).data.status).toBe('paused');

    const resumed = await call('resume');
    expect((resumed.body as Success<Ticket>).data.status).toBe('onsale');
  });

  it('US-TKT-03: a tier whose window has closed cannot be resumed', async () => {
    const jwt = await token(ADMIN, ORG.slug);
    const created = await createTicket(jwt, {
      name: 'Closed window',
      total: 20,
    });
    const id = (created.body as Success<Ticket>).data.id;
    await pool.query(
      `UPDATE ticket_types SET status = 'paused', sales_end_at = now() - interval '1 day' WHERE id = $1`,
      [id],
    );
    const res = await request(server)
      .post(`/api/v1/events/${eventId}/tickets/${id}/resume`)
      .set('Authorization', `Bearer ${jwt}`);
    expect(res.status).toBe(409);
    expect((res.body as { message: string }).message).toMatch(/end date/i);
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

  it('US-TKT-05: a tier that never sold is removed completely', async () => {
    const jwt = await token(ADMIN, ORG.slug);
    const created = await createTicket(jwt, { name: 'Mistake', total: 100 });
    const ticketId = (created.body as Success<Ticket>).data.id;

    const res = await request(server)
      .delete(`/api/v1/events/${eventId}/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${jwt}`);
    expect(res.status).toBe(200);
    expect((res.body as Success<{ outcome: string }>).data.outcome).toBe(
      'removed',
    );
    const { rows } = await pool.query(
      `SELECT id FROM ticket_types WHERE id = $1`,
      [ticketId],
    );
    expect(rows).toHaveLength(0); // gone, not hidden
  });

  it('US-TKT-05: a tier that has sold is retired — the holders keep their tickets', async () => {
    const jwt = await token(ADMIN, ORG.slug);
    const created = await createTicket(jwt, { name: 'Sold Out', total: 300 });
    const ticketId = (created.body as Success<Ticket>).data.id;
    await pool.query(`UPDATE ticket_types SET sold = 210 WHERE id = $1`, [
      ticketId,
    ]);

    const res = await request(server)
      .delete(`/api/v1/events/${eventId}/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${jwt}`);
    expect(res.status).toBe(200);
    expect((res.body as Success<{ outcome: string }>).data.outcome).toBe(
      'retired',
    );

    // the row survives (so issued tickets still resolve) but leaves the active list
    const { rows } = await pool.query<{
      deleted_at: Date | null;
      sold: number;
    }>(`SELECT deleted_at, sold FROM ticket_types WHERE id = $1`, [ticketId]);
    expect(rows[0].deleted_at).not.toBeNull();
    expect(Number(rows[0].sold)).toBe(210); // nothing was refunded or cancelled

    const list = await request(server)
      .get(`/api/v1/events/${eventId}/tickets`)
      .set('Authorization', `Bearer ${jwt}`);
    const names = (list.body as Success<Ticket[]>).data.map((t) => t.name);
    expect(names).not.toContain('Sold Out');
  });

  it('US-TKT-05: refuses while a checkout is in progress', async () => {
    const jwt = await token(ADMIN, ORG.slug);
    const created = await createTicket(jwt, {
      name: 'Mid-checkout',
      total: 50,
    });
    const ticketId = (created.body as Success<Ticket>).data.id;
    const { rows } = await pool.query<{ organization_id: string }>(
      `SELECT organization_id FROM ticket_types WHERE id = $1`,
      [ticketId],
    );
    await pool.query(
      `INSERT INTO seat_holds (organization_id, event_id, ticket_type_id, quantity, status, expires_at)
       VALUES ($1, $2, $3, 2, 'active', now() + interval '10 minutes')`,
      [rows[0].organization_id, eventId, ticketId],
    );

    const res = await request(server)
      .delete(`/api/v1/events/${eventId}/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${jwt}`);
    expect(res.status).toBe(409);
    expect((res.body as { message: string }).message).toMatch(/pause/i);
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
