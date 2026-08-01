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
const ORG = { slug: 'profile-e2e', name: 'Profile E2E' };
const ME = 'me@profile-e2e.test';
const OTHER = 'other@profile-e2e.test';

interface Success<T> {
  data: T;
}
interface Profile {
  name: string;
  email: string;
  pendingEmail: string | null;
  emailVerified: boolean;
  phone: string | null;
  timezone: string | null;
  locale: string | null;
}

describe('My profile (e2e — US-SET-01)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let jwt: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    await seed(pool);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();
    server = app.getHttpServer() as Server;

    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: ME, password: PASSWORD, orgSlug: ORG.slug });
    jwt = (res.body as Success<{ accessToken: string }>).data.accessToken;
  }, 30000);

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  const get = () =>
    request(server)
      .get('/api/v1/me/profile')
      .set('Authorization', `Bearer ${jwt}`);
  const patch = (body: object) =>
    request(server)
      .patch('/api/v1/me/profile')
      .set('Authorization', `Bearer ${jwt}`)
      .send(body);

  it('shows the fields the page edits, verified while no change is pending', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect((res.body as Success<Profile>).data).toMatchObject({
      email: ME,
      emailVerified: true,
    });
  });

  it('saves name, phone, timezone and language', async () => {
    const res = await patch({
      name: 'Somchai S.',
      phone: '+66812345678',
      timezone: 'Asia/Bangkok',
      locale: 'th',
    });
    expect(res.status).toBe(200);
    expect((res.body as Success<Profile>).data).toMatchObject({
      name: 'Somchai S.',
      phone: '+66812345678',
      timezone: 'Asia/Bangkok',
      locale: 'th',
    });
  });

  it('a partial save keeps the other fields', async () => {
    await patch({ phone: '+66899999999' });
    expect((await get()).body).toMatchObject({
      data: { name: 'Somchai S.', timezone: 'Asia/Bangkok' },
    });
  });

  it('rejects an unknown timezone (422)', async () => {
    const res = await patch({ timezone: 'Mars/Olympus' });
    expect(res.status).toBe(422);
  });

  it('email change: current email keeps working, shows unverified, link goes to the NEW address', async () => {
    const res = await request(server)
      .post('/api/v1/me/profile/email')
      .set('Authorization', `Bearer ${jwt}`)
      .send({ email: 'changed@profile-e2e.test' });
    expect(res.status).toBe(202);
    const p = (res.body as Success<Profile>).data;
    expect(p).toMatchObject({
      email: ME, // unchanged — still the sign-in address
      pendingEmail: 'changed@profile-e2e.test',
      emailVerified: false,
    });

    // the confirmation went to the requested address only
    const { rows } = await pool.query<{ email: string; url: string }>(
      `SELECT payload->>'email' email, payload->>'confirmUrl' url FROM outbox_events
       WHERE routing_key = 'identity.email_change_requested' ORDER BY id DESC LIMIT 1`,
    );
    expect(rows[0].email).toBe('changed@profile-e2e.test');

    // signing in with the ORIGINAL email still works
    const stillWorks = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: ME, password: PASSWORD, orgSlug: ORG.slug });
    expect(stillWorks.status).toBe(200);

    // opening the link promotes it
    const token = new URL(rows[0].url).searchParams.get('token');
    const confirmed = await request(server)
      .post('/api/v1/me/profile/email/confirm')
      .send({ token });
    expect(confirmed.status).toBe(200);
    expect((confirmed.body as Success<Profile>).data).toMatchObject({
      email: 'changed@profile-e2e.test',
      pendingEmail: null,
      emailVerified: true,
    });
  });

  it('refuses an address already used in the workspace (409)', async () => {
    const res = await request(server)
      .post('/api/v1/me/profile/email')
      .set('Authorization', `Bearer ${jwt}`)
      .send({ email: OTHER });
    expect(res.status).toBe(409);
  });

  it('requires authentication (401)', async () => {
    expect((await request(server).get('/api/v1/me/profile')).status).toBe(401);
  });
});

async function seed(pool: Pool): Promise<void> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
    [ORG.name, ORG.slug],
  );
  const orgId = Number(res.rows[0].id);
  const passwordHash = await hash(PASSWORD);
  for (const email of [ME, OTHER]) {
    await pool.query(
      `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
       VALUES ($1, 'Somchai', $2, 'admin', 'Active', $3)`,
      [orgId, email, passwordHash],
    );
  }
}

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM outbox_events WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug = $1)`,
    [ORG.slug],
  );
  await pool.query(`DELETE FROM organizations WHERE slug = $1`, [ORG.slug]);
}
