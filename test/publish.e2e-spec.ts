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
import { LANDING_TEMPLATES } from '../src/modules/events/landing-templates';

const PASSWORD = 'correct horse battery staple';
const ORG = { slug: 'pub-e2e', name: 'Publish E2E' };
const ADMIN = 'admin@pub-e2e.test'; // evCreate + evPublish
const EDITOR = 'editor@pub-e2e.test'; // evCreate only (no evPublish); Organizer role

interface Success<T> {
  data: T;
}
interface Failure {
  message: string;
}
interface Event {
  id: string;
  status: string;
  visibility: string;
  landingTemplateId: string | null;
  publishedAt: string | null;
  version: number;
}

describe('Publish / unpublish (e2e — US-EVT-07)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let adminJwt: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    await seedOrg(pool, ORG, [
      { email: ADMIN, roleName: 'Admin', grants: ['evCreate', 'evPublish'] },
      { email: EDITOR, roleName: 'Organizer', grants: ['evCreate'] },
    ]);
    await seedLandingTemplates(pool);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();
    server = app.getHttpServer() as Server;
    adminJwt = await token(ADMIN);
  }, 30000);

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  const token = async (email: string) => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, orgSlug: ORG.slug, persona: 'admin' });
    return (res.body as Success<{ accessToken: string }>).data.accessToken;
  };

  const auth = (jwt: string) => ({ Authorization: `Bearer ${jwt}` });

  async function createEvent(startAt: string): Promise<string> {
    const res = await request(server)
      .post('/api/v1/events')
      .set(auth(adminJwt))
      .send({ name: `Event ${startAt}`, type: 'Conference', startAt });
    return (res.body as Success<{ id: string }>).data.id;
  }

  /** A draft that satisfies every readiness requirement (description, venue, ticket). */
  async function readyDraft(startAt: string): Promise<string> {
    const id = await createEvent(startAt);
    await request(server)
      .patch(`/api/v1/events/${id}`)
      .set(auth(adminJwt))
      .send({ description: 'A great event', venueName: 'Grand Hall' })
      .expect(200);
    await request(server)
      .post(`/api/v1/events/${id}/tickets`)
      .set(auth(adminJwt))
      .send({ name: 'General', priceSatang: 50000, total: 100 })
      .expect(201);
    return id;
  }

  const publish = (
    id: string,
    jwt: string,
    body: Record<string, unknown> = {},
  ) =>
    request(server)
      .post(`/api/v1/events/${id}/publish`)
      .set(auth(jwt))
      .send(body);

  const FUTURE = '2026-12-01T02:00:00Z';
  const PAST = '2020-01-01T02:00:00Z';

  it('blocks publish and flags the missing items (422)', async () => {
    const id = await createEvent(FUTURE); // no description, no venue, no ticket
    const res = await publish(id, adminJwt);
    expect(res.status).toBe(422);
    expect((res.body as Failure).message).toMatch(/description/i);
    expect((res.body as Failure).message).toMatch(/ticket/i);
  });

  it('publishes a complete draft: upcoming, public, template + published_at set', async () => {
    const id = await readyDraft(FUTURE);
    const res = await publish(id, adminJwt, {
      visibility: 'public',
      landingTemplateId: 'aurora',
    });
    expect(res.status).toBe(200);
    const e = (res.body as Success<Event>).data;
    expect(e).toMatchObject({
      status: 'upcoming',
      visibility: 'public',
      landingTemplateId: 'aurora',
    });
    expect(e.publishedAt).not.toBeNull();
  });

  it('records the "event published" notice in the outbox', async () => {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::int AS count FROM outbox_events oe
         JOIN organizations o ON o.id = oe.organization_id
        WHERE o.slug = $1 AND oe.routing_key = 'events.published'`,
      [ORG.slug],
    );
    expect(Number(rows[0].count)).toBeGreaterThanOrEqual(1);
  });

  it('rejects re-publishing an already-published event (409)', async () => {
    const id = await readyDraft(FUTURE);
    await publish(id, adminJwt, { visibility: 'public' }).expect(200);
    await publish(id, adminJwt).expect(409);
  });

  it('unpublishes: back to a private draft with published_at cleared', async () => {
    const id = await readyDraft(FUTURE);
    await publish(id, adminJwt, { visibility: 'public' }).expect(200);
    const res = await request(server)
      .post(`/api/v1/events/${id}/unpublish`)
      .set(auth(adminJwt));
    expect(res.status).toBe(200);
    const e = (res.body as Success<Event>).data;
    expect(e).toMatchObject({ status: 'draft', visibility: 'private' });
    expect(e.publishedAt).toBeNull();
  });

  it('forbids publishing without the evPublish permission (403)', async () => {
    const id = await readyDraft(FUTURE);
    const editorJwt = await token(EDITOR);
    await publish(id, editorJwt).expect(403);
  });

  it('asks to confirm a past start date (422), then publishes when confirmed', async () => {
    const id = await readyDraft(PAST);
    const blocked = await publish(id, adminJwt);
    expect(blocked.status).toBe(422);
    expect((blocked.body as Failure).message).toMatch(/past/i);

    await publish(id, adminJwt, { confirmPastStart: true }).expect(200);
  });
});

const PERM_GROUP: Record<string, string> = {
  evCreate: 'Events',
  evPublish: 'Events',
};

async function seedLandingTemplates(pool: Pool): Promise<void> {
  for (const t of LANDING_TEMPLATES) {
    await pool.query(
      `INSERT INTO landing_templates (id, title, badge, description)
       VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
      [t.id, t.title, t.badge, t.description],
    );
  }
}

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
