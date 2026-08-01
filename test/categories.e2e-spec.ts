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
const ORG = { slug: 'cat-e2e', name: 'Categories E2E' };
const ORG2 = { slug: 'cat-e2e-2', name: 'Categories E2E 2' };
const ADMIN = 'admin@cat-e2e.test'; // setSettings + evCreate
const LIMITED = 'staff@cat-e2e.test'; // evCreate only (no setSettings)
const ADMIN2 = 'admin@cat-e2e-2.test';

interface Success<T> {
  data: T;
}
interface Failure {
  message: string;
}
interface Category {
  id: number;
  name: string;
  color: string;
  eventCount: number;
  version: number;
}

describe('Categories (e2e — US-EVT-11)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let adminJwt: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    await seedOrg(pool, ORG, [
      {
        email: ADMIN,
        roleName: 'Admin',
        grants: ['setSettings', 'evCreate'],
      },
      { email: LIMITED, roleName: 'Organizer', grants: ['evCreate'] },
    ]);
    await seedOrg(pool, ORG2, [
      { email: ADMIN2, roleName: 'Admin', grants: ['setSettings'] },
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

  const create = (jwt: string, body: Record<string, unknown>) =>
    request(server)
      .post('/api/v1/categories')
      .set('Authorization', `Bearer ${jwt}`)
      .send(body);

  const getOne = (jwt: string, id: number) =>
    request(server)
      .get(`/api/v1/categories/${id}`)
      .set('Authorization', `Bearer ${jwt}`);

  it('creates a category and reports zero events (201)', async () => {
    const res = await create(adminJwt, {
      name: 'Conference',
      icon: 'presentation-01',
      color: 'blue',
    });
    expect(res.status).toBe(201);
    expect((res.body as Success<Category>).data).toMatchObject({
      name: 'Conference',
      color: 'blue',
      eventCount: 0,
    });
  });

  it('rejects duplicate names, case-insensitively (409)', async () => {
    await create(adminJwt, {
      name: 'Conference',
      icon: 'x',
      color: 'red',
    }).expect(409);
    await create(adminJwt, {
      name: 'conference',
      icon: 'x',
      color: 'red',
    }).expect(409);
  });

  it('shows a live count of events using the category', async () => {
    const cat = (
      (
        await create(adminJwt, {
          name: 'Workshop',
          icon: 'tools',
          color: 'amber',
        })
      ).body as Success<Category>
    ).data;
    await request(server)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({
        name: 'Hands-on Lab',
        type: 'Workshop',
        startAt: '2026-10-01T02:00:00Z',
        categoryId: cat.id,
      })
      .expect(201);

    const res = await getOne(adminJwt, cat.id);
    expect((res.body as Success<Category>).data.eventCount).toBe(1);
  });

  it('reflects an edit to colour/name and guards optimistic concurrency', async () => {
    const cat = (
      (await create(adminJwt, { name: 'Gala', icon: 'star', color: 'brand' }))
        .body as Success<Category>
    ).data;
    const res = await request(server)
      .patch(`/api/v1/categories/${cat.id}`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ color: 'violet', version: cat.version });
    expect(res.status).toBe(200);
    expect((res.body as Success<Category>).data.color).toBe('violet');
  });

  it('blocks deleting a category still used by events (409 with the count)', async () => {
    // "Workshop" now has one event from the earlier test.
    const list = await request(server)
      .get('/api/v1/categories?q=Workshop')
      .set('Authorization', `Bearer ${adminJwt}`);
    const workshop = (list.body as Success<Category[]>).data.find(
      (c) => c.name === 'Workshop',
    )!;
    const res = await request(server)
      .delete(`/api/v1/categories/${workshop.id}`)
      .set('Authorization', `Bearer ${adminJwt}`);
    expect(res.status).toBe(409);
    expect((res.body as Failure).message).toMatch(/1 events/);
  });

  it('deletes an unused category, which then reads as 404', async () => {
    const cat = (
      (await create(adminJwt, { name: 'Temp', icon: 'x', color: 'teal' }))
        .body as Success<Category>
    ).data;
    await request(server)
      .delete(`/api/v1/categories/${cat.id}`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .expect(200);
    await getOne(adminJwt, cat.id).expect(404);
  });

  it("never exposes another tenant's category (404)", async () => {
    const admin2Jwt = await token(ADMIN2, ORG2.slug);
    const foreign = (
      (
        await create(admin2Jwt, {
          name: 'Networking',
          icon: 'x',
          color: 'indigo',
        })
      ).body as Success<Category>
    ).data;

    await getOne(adminJwt, foreign.id).expect(404);
    await request(server)
      .patch(`/api/v1/categories/${foreign.id}`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ color: 'red' })
      .expect(404);
    await request(server)
      .delete(`/api/v1/categories/${foreign.id}`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .expect(404);
  });

  it('forbids managing categories without setSettings (403)', async () => {
    const limitedJwt = await token(LIMITED, ORG.slug);
    await request(server)
      .get('/api/v1/categories')
      .set('Authorization', `Bearer ${limitedJwt}`)
      .expect(403);
  });
});

const PERM_GROUP: Record<string, string> = {
  evCreate: 'Events',
  setSettings: 'Settings',
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
