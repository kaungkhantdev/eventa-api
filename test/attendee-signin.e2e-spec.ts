process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://eventa:eventa@localhost:5432/eventa';
process.env.JWT_SECRET ??= 'test-secret-at-least-16-characters-long';
process.env.LOGIN_MAX_ATTEMPTS = '3'; // keep the lockout test quick

import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { buildValidationPipe } from '../src/common/http/validation';

const PASSWORD = 'correct horse battery staple';
const WORKSPACE = { slug: 'att-signin-e2e', name: 'Attendee Signin E2E' };
/**
 * Every email is unique per run: the login throttle lives in Redis with a
 * 15-minute lock TTL, which outlives any database cleanup — a fixed email that
 * this suite deliberately fails would accumulate strikes across runs and start
 * answering 429 where the test expects 401.
 */
const RUN = Date.now();
const ANAN = `anan-${RUN}@att-signin.test`;
const LOCKME = `lockme-${RUN}@att-signin.test`;
const ORGANIZER = `owner-${RUN}@att-signin.test`;
const NOBODY = `nobody-${RUN}@att-signin.test`;

interface Success<T> {
  data: T;
}
interface LoginBody {
  accessToken: string;
  user: {
    persona: string;
    organization: { slug: string };
  };
}

describe('Attendee sign-in (e2e — US-DISC-08)', () => {
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

  const login = (body: object) =>
    request(server).post('/api/v1/auth/login').send(body);

  it('signs an attendee in with just email and password — no workspace', async () => {
    const res = await login({
      email: ANAN,
      password: PASSWORD,
      persona: 'attendee',
    });
    expect(res.status).toBe(200);
    const body = (res.body as Success<LoginBody>).data;
    expect(body.accessToken).toBeTruthy();
    expect(body.user.persona).toBe('attendee');
    // The account lives in the ONE platform workspace, whoever runs the events.
    expect(body.user.organization.slug).toBe('eventa');
  });

  it('refuses an attendee login that names a workspace', async () => {
    const res = await login({
      email: ANAN,
      password: PASSWORD,
      persona: 'attendee',
      orgSlug: WORKSPACE.slug,
    });
    expect(res.status).toBe(422);
    expect((res.body as { message: string }).message).toMatch(/workspace/i);
  });

  it('still requires the workspace slug for an organizer login', async () => {
    const res = await login({ email: ORGANIZER, password: PASSWORD });
    expect(res.status).toBe(422);
  });

  it('an organizer account cannot sign in through the attendee door', async () => {
    // Same email may exist in both realms (ADR-8); the personas never cross.
    const res = await login({
      email: ORGANIZER,
      password: PASSWORD,
      persona: 'attendee',
    });
    expect(res.status).toBe(401);
  });

  it('says only that the email or password is wrong — never which', async () => {
    const wrongPassword = await login({
      email: ANAN,
      password: 'not-the-password',
      persona: 'attendee',
    });
    const unknownEmail = await login({
      email: NOBODY,
      password: PASSWORD,
      persona: 'attendee',
    });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    // The two failures are indistinguishable, so an email can't be probed.
    expect((wrongPassword.body as { message: string }).message).toBe(
      (unknownEmail.body as { message: string }).message,
    );
  });

  it('lands the attendee in their own area, never the organizer console', async () => {
    const signedIn = await login({
      email: ANAN,
      password: PASSWORD,
      persona: 'attendee',
    });
    const token = (signedIn.body as Success<LoginBody>).data.accessToken;

    const mine = await request(server)
      .get('/api/v1/me/saved-events')
      .set('Authorization', `Bearer ${token}`);
    expect(mine.status).toBe(200);

    const console_ = await request(server)
      .get('/api/v1/events')
      .set('Authorization', `Bearer ${token}`);
    expect(console_.status).toBe(403);
    expect((console_.body as { message: string }).message).toMatch(/admin/i);
  });

  it('temporarily blocks the account after repeated failures', async () => {
    const attempt = () =>
      login({
        email: LOCKME,
        password: 'wrong-wrong-wrong',
        persona: 'attendee',
      });
    for (let i = 0; i < 3; i += 1) expect((await attempt()).status).toBe(401);
    // Locked now — even the CORRECT password is refused until the cool-off.
    const locked = await login({
      email: LOCKME,
      password: PASSWORD,
      persona: 'attendee',
    });
    expect(locked.status).toBe(429);
  });
});

async function seed(pool: Pool): Promise<void> {
  const workspace = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1,$2) RETURNING id`,
    [WORKSPACE.name, WORKSPACE.slug],
  );
  const platform = await pool.query<{ id: string }>(
    `SELECT id FROM organizations WHERE slug = 'eventa'`,
  );
  const passwordHash = await hash(PASSWORD);
  for (const email of [ANAN, LOCKME]) {
    await pool.query(
      `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
       VALUES ($1,'Attendee',$2,'attendee','Active',$3)`,
      [Number(platform.rows[0].id), email, passwordHash],
    );
  }
  await pool.query(
    `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
     VALUES ($1,'Owner',$2,'admin','Active',$3)`,
    [Number(workspace.rows[0].id), ORGANIZER, passwordHash],
  );
}

async function cleanup(pool: Pool): Promise<void> {
  // The platform org is shared and permanent — remove only OUR users from it.
  // LIKE catches this run's emails and any earlier run's leftovers.
  await pool.query(
    `DELETE FROM outbox_events WHERE aggregate_id IN
       (SELECT id::text FROM users WHERE email LIKE '%@att-signin.test')`,
  );
  await pool.query(`DELETE FROM users WHERE email LIKE '%@att-signin.test'`);
  await pool.query(`DELETE FROM organizations WHERE slug = $1`, [
    WORKSPACE.slug,
  ]);
}
