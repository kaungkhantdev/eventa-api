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
const ORG = { slug: 'cd-e2e', name: 'Cancel/Delete E2E' };
const ORG2 = { slug: 'cd-e2e-2', name: 'Cancel/Delete E2E 2' };
const ADMIN = 'admin@cd-e2e.test'; // evPublish + evCreate
const LIMITED = 'staff@cd-e2e.test'; // evCreate only (no evPublish)
const ADMIN2 = 'admin@cd-e2e-2.test';

interface Success<T> {
  data: T;
}
interface Event {
  id: string;
  status: string;
  bucket: string;
}

describe('Cancel / delete (e2e — US-EVT-08)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let adminJwt: string;
  let foreignEventId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    await seedOrg(pool, ORG, [
      { email: ADMIN, roleName: 'Admin', grants: ['evPublish', 'evCreate'] },
      { email: LIMITED, roleName: 'Organizer', grants: ['evCreate'] },
    ]);
    await seedOrg(pool, ORG2, [
      { email: ADMIN2, roleName: 'Admin', grants: ['evPublish', 'evCreate'] },
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

  const del = (id: string, jwt: string) =>
    request(server)
      .delete(`/api/v1/events/${id}`)
      .set('Authorization', `Bearer ${jwt}`);

  const cancel = (id: string, jwt: string, body: Record<string, unknown>) =>
    request(server)
      .post(`/api/v1/events/${id}/cancel`)
      .set('Authorization', `Bearer ${jwt}`)
      .send(body);

  const getEvent = (id: string, jwt: string) =>
    request(server)
      .get(`/api/v1/events/${id}`)
      .set('Authorization', `Bearer ${jwt}`);

  it('permanently deletes a draft with no registrations', async () => {
    const id = await createEvent(adminJwt, 'Deletable Draft');
    await del(id, adminJwt).expect(200);
    await getEvent(id, adminJwt).expect(404);
  });

  it('blocks deleting a published event and routes to Cancel (409)', async () => {
    const id = await createEvent(adminJwt, 'Published');
    await pool.query(`UPDATE events SET status = 'upcoming' WHERE id = $1`, [
      id,
    ]);
    const res = await del(id, adminJwt);
    expect(res.status).toBe(409);
    expect((res.body as { message: string }).message).toMatch(/cancel/i);
  });

  it('blocks deleting a draft that has sales (409)', async () => {
    const id = await createEvent(adminJwt, 'Draft With Sales');
    const ticket = await request(server)
      .post(`/api/v1/events/${id}/tickets`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ name: 'GA', priceSatang: 10000, total: 100 });
    const ticketId = (ticket.body as Success<{ id: string }>).data.id;
    await pool.query(`UPDATE ticket_types SET sold = 3 WHERE id = $1`, [
      ticketId,
    ]);

    await del(id, adminJwt).expect(409);
  });

  it('cancels a published event: moves out of Active and notifies', async () => {
    const id = await createEvent(adminJwt, 'To Cancel');
    await pool.query(`UPDATE events SET status = 'upcoming' WHERE id = $1`, [
      id,
    ]);

    const res = await cancel(id, adminJwt, { reason: 'Venue flooded' });
    expect(res.status).toBe(200);
    expect((res.body as Success<Event>).data.status).toBe('cancelled');

    // It drops out of the Active bucket.
    const active = await request(server)
      .get('/api/v1/events?bucket=active')
      .set('Authorization', `Bearer ${adminJwt}`);
    const activeIds = (active.body as Success<Event[]>).data.map((e) => e.id);
    expect(activeIds).not.toContain(id);

    // The cancellation was queued for the worker.
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::int AS n FROM outbox_events oe
         JOIN organizations o ON o.id = oe.organization_id
        WHERE o.slug = $1 AND oe.routing_key = 'events.cancelled'
          AND oe.aggregate_id = $2`,
      [ORG.slug, id],
    );
    expect(Number(rows[0].n)).toBe(1);
  });

  it('requires a cancellation reason (422)', async () => {
    const id = await createEvent(adminJwt, 'Reasonless');
    await pool.query(`UPDATE events SET status = 'upcoming' WHERE id = $1`, [
      id,
    ]);
    await cancel(id, adminJwt, { reason: '   ' }).expect(422);
  });

  it('rejects cancelling an already-cancelled event (409)', async () => {
    const id = await createEvent(adminJwt, 'Double Cancel');
    await pool.query(`UPDATE events SET status = 'upcoming' WHERE id = $1`, [
      id,
    ]);
    await cancel(id, adminJwt, { reason: 'once' }).expect(200);
    await cancel(id, adminJwt, { reason: 'twice' }).expect(409);
  });

  it('forbids delete/cancel without evPublish (403)', async () => {
    const id = await createEvent(adminJwt, 'Guarded');
    const limitedJwt = await token(LIMITED, ORG.slug);
    await del(id, limitedJwt).expect(403);
    await cancel(id, limitedJwt, { reason: 'nope' }).expect(403);
  });

  it("forbids deleting another tenant's event (404)", async () => {
    await del(foreignEventId, adminJwt).expect(404);
  });
});

const PERM_GROUP: Record<string, string> = {
  evCreate: 'Events',
  evPublish: 'Events',
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
