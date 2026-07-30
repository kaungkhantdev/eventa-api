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
const ORG = { slug: 'spk-e2e', name: 'Speakers E2E' };
const ORG2 = { slug: 'spk-e2e-2', name: 'Speakers E2E 2' };
const ADMIN = 'admin@spk-e2e.test'; // evSpeakers + evCreate
const LIMITED = 'staff@spk-e2e.test'; // evCreate only (no evSpeakers)
const ADMIN2 = 'admin@spk-e2e-2.test';

interface Success<T> {
  data: T;
}
interface Speaker {
  id: string;
  name: string;
  role: string | null;
  tag: string | null;
  version: number;
}

describe('Speakers (e2e — US-EVT-09)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let adminJwt: string;
  let eventId: string;
  let foreignEventId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    await seedOrg(pool, ORG, [
      { email: ADMIN, roleName: 'Admin', grants: ['evSpeakers', 'evCreate'] },
      { email: LIMITED, roleName: 'Organizer', grants: ['evCreate'] },
    ]);
    await seedOrg(pool, ORG2, [
      { email: ADMIN2, roleName: 'Admin', grants: ['evSpeakers', 'evCreate'] },
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
    eventId = await createEvent(adminJwt, 'Speaker Event');
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

  const addSpeaker = (jwt: string, body: Record<string, unknown>) =>
    request(server)
      .post(`/api/v1/events/${eventId}/speakers`)
      .set('Authorization', `Bearer ${jwt}`)
      .send(body);

  it('adds a speaker card with optional fields (201)', async () => {
    const res = await addSpeaker(adminJwt, {
      name: 'Ada Lovelace',
      role: 'Mathematician',
      talkTitle: 'The Analytical Engine',
      tag: 'Keynote',
      tone: 'purple',
    });
    expect(res.status).toBe(201);
    expect((res.body as Success<Speaker>).data).toMatchObject({
      name: 'Ada Lovelace',
      role: 'Mathematician',
      tag: 'Keynote',
    });
  });

  it('rejects a blank name (422)', async () => {
    await addSpeaker(adminJwt, { name: '   ' }).expect(422);
  });

  it('lists the event speakers', async () => {
    await addSpeaker(adminJwt, { name: 'Grace Hopper' }).expect(201);
    const res = await request(server)
      .get(`/api/v1/events/${eventId}/speakers`)
      .set('Authorization', `Bearer ${adminJwt}`);
    expect(res.status).toBe(200);
    const names = (res.body as Success<Speaker[]>).data.map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining(['Ada Lovelace', 'Grace Hopper']),
    );
  });

  it('edits and then removes a speaker', async () => {
    const created = await addSpeaker(adminJwt, { name: 'Alan Turing' });
    const speaker = (created.body as Success<Speaker>).data;

    const patched = await request(server)
      .patch(`/api/v1/events/${eventId}/speakers/${speaker.id}`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ role: 'Cryptanalyst', version: speaker.version });
    expect(patched.status).toBe(200);
    expect((patched.body as Success<Speaker>).data.role).toBe('Cryptanalyst');

    await request(server)
      .delete(`/api/v1/events/${eventId}/speakers/${speaker.id}`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .expect(200);
  });

  it("forbids adding a speaker to another tenant's event (404)", async () => {
    const res = await request(server)
      .post(`/api/v1/events/${foreignEventId}/speakers`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ name: 'Sneaky' });
    expect(res.status).toBe(404);
  });

  it('forbids a user without evSpeakers (403)', async () => {
    const limitedJwt = await token(LIMITED, ORG.slug);
    await addSpeaker(limitedJwt, { name: 'Nope' }).expect(403);
  });
});

const PERM_GROUP: Record<string, string> = {
  evCreate: 'Events',
  evSpeakers: 'Events',
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
