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
const ORG = { slug: 'social-e2e', name: 'Social E2E' };
const EXISTING = 'existing@social-e2e.test';
const NEWCOMER = 'newcomer@social-e2e.test';
const ATTENDEE = 'attendee@social-e2e.test';

/** The dev verifier accepts a base64url JSON stand-in for a real id token. */
const idToken = (claims: Record<string, unknown>): string =>
  Buffer.from(JSON.stringify(claims)).toString('base64url');

interface Success<T> {
  data: T;
}
interface Login {
  accessToken: string;
  user: { email: string; persona: string };
}

describe('Social sign-in (e2e — US-ACC-06)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;

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
  }, 30000);

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  const organizer = (body: Record<string, unknown>) =>
    request(server).post('/api/v1/auth/social/organizer').send(body);
  const attendee = (body: Record<string, unknown>) =>
    request(server).post('/api/v1/auth/social/attendee').send(body);

  it('a new person gets an account already confirmed and is signed in', async () => {
    const res = await organizer({
      provider: 'google',
      idToken: idToken({
        subject: 'google-new-1',
        email: NEWCOMER,
        name: 'New Comer',
      }),
    });
    expect(res.status).toBe(200);
    const data = (res.body as Success<Login>).data;
    expect(data.user).toMatchObject({ email: NEWCOMER, persona: 'admin' });
    expect(data.accessToken).toBeTruthy();

    // created ACTIVE — no confirmation email needed, and no password set
    const { rows } = await pool.query<{ status: string; hash: string | null }>(
      `SELECT status, password_hash AS hash FROM users WHERE email = $1`,
      [NEWCOMER],
    );
    expect(rows[0].status).toBe('Active');
    expect(rows[0].hash).toBeNull();
  });

  it('links to an existing password account with the same email — no duplicate', async () => {
    const before = await countUsers(EXISTING);
    const res = await organizer({
      provider: 'google',
      idToken: idToken({ subject: 'google-existing-1', email: EXISTING }),
    });
    expect(res.status).toBe(200);
    expect(await countUsers(EXISTING)).toBe(before);

    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*) n FROM social_identities si
         JOIN users u ON u.id = si.user_id
        WHERE u.email = $1 AND si.provider = 'google'`,
      [EXISTING],
    );
    expect(Number(rows[0].n)).toBe(1);

    // the password still works — linking did not disturb it
    const password = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: EXISTING, password: PASSWORD, orgSlug: ORG.slug });
    expect(password.status).toBe(200);
  });

  it('signs the same person in again through the existing link', async () => {
    const res = await organizer({
      provider: 'google',
      idToken: idToken({ subject: 'google-existing-1', email: EXISTING }),
    });
    expect(res.status).toBe(200);
    expect(await countUsers(EXISTING)).toBe(1);
  });

  it('a cancelled consent screen signs nobody in (401)', async () => {
    const res = await organizer({ provider: 'google', error: 'access_denied' });
    expect(res.status).toBe(401);
    expect((res.body as { message: string }).message).toMatch(/cancelled/i);
  });

  it('rejects an email the provider has not verified (422)', async () => {
    const res = await organizer({
      provider: 'google',
      idToken: idToken({
        subject: 'google-unverified',
        email: 'unverified@social-e2e.test',
        emailVerified: false,
      }),
    });
    expect(res.status).toBe(422);
  });

  describe('the two audiences never cross', () => {
    it('an organizer cannot use Apple; an attendee cannot use LinkedIn (422)', async () => {
      expect(
        (
          await organizer({
            provider: 'apple',
            idToken: idToken({ subject: 'a', email: 'a@x.test' }),
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await attendee({
            provider: 'linkedin',
            orgSlug: ORG.slug,
            idToken: idToken({ subject: 'b', email: 'b@x.test' }),
          })
        ).status,
      ).toBe(422);
    });

    it('an attendee sign-in creates an ATTENDEE, not an organizer', async () => {
      const res = await attendee({
        provider: 'google',
        orgSlug: ORG.slug,
        idToken: idToken({ subject: 'google-att-1', email: ATTENDEE }),
      });
      expect(res.status).toBe(200);
      expect((res.body as Success<Login>).data.user.persona).toBe('attendee');
    });

    it('an organizer flow refuses an account linked to the attendee realm (401)', async () => {
      const res = await organizer({
        provider: 'google',
        idToken: idToken({ subject: 'google-att-1', email: ATTENDEE }),
      });
      expect(res.status).toBe(401);
    });

    it('an attendee sign-in must say which workspace (422)', async () => {
      const res = await attendee({
        provider: 'google',
        idToken: idToken({
          subject: 'google-att-2',
          email: 'x@social-e2e.test',
        }),
      });
      expect(res.status).toBe(422);
    });
  });

  async function countUsers(email: string): Promise<number> {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*) n FROM users WHERE email = $1`,
      [email],
    );
    return Number(rows[0].n);
  }
});

async function seed(pool: Pool): Promise<void> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
    [ORG.name, ORG.slug],
  );
  const orgId = Number(res.rows[0].id);
  await pool.query(
    `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
     VALUES ($1, 'Existing', $2, 'admin', 'Active', $3)`,
    [orgId, EXISTING, await hash(PASSWORD)],
  );
}

async function cleanup(pool: Pool): Promise<void> {
  for (const slug of [
    ORG.slug,
    'new-comers-workspace',
    'newcomers-workspace',
  ]) {
    await pool.query(
      `DELETE FROM organizations WHERE slug = $1 OR slug LIKE $2`,
      [slug, `${slug}%`],
    );
  }
  await pool.query(
    `DELETE FROM organizations WHERE id IN (
       SELECT organization_id FROM users WHERE email IN ($1, $2, $3))`,
    [NEWCOMER, ATTENDEE, 'unverified@social-e2e.test'],
  );
}
