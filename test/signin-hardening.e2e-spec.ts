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

const PASSWORD = 'signin1password';
const OWNER = 'owner@signin-e2e.test';
const SUSPENDED = 'suspended@signin-e2e.test';
const ATTENDEE = 'attendee@signin-e2e.test';
const ORG_SLUG = 'signin-co';

describe('Sign-in hardening & audience separation (US-ACC-02/03/08/11, e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let orgId: number;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();
    server = app.getHttpServer() as Server;

    // Register the owner (stays unconfirmed until the verify test runs).
    await request(server).post('/api/v1/auth/register').send({
      name: 'Signin Owner',
      email: OWNER,
      password: PASSWORD,
      organizationName: 'Signin Co',
      acceptTerms: true,
    });
    orgId = (
      await pool.query<{ id: string }>(
        `SELECT id FROM organizations WHERE slug = $1`,
        [ORG_SLUG],
      )
    ).rows.map((r) => Number(r.id))[0];

    // Seed a suspended organizer + an active attendee directly.
    const pwHash = await hash(PASSWORD);
    await seedUser(SUSPENDED, 'admin', 'Suspended', pwHash);
    await seedAttendee(ATTENDEE, pwHash);
  });

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  const login = (body: Record<string, unknown>) =>
    request(server)
      .post('/api/v1/auth/login')
      .send({
        orgSlug: ORG_SLUG,
        persona: 'admin',
        ...body,
      });

  const latestSessionExpiry = async (email: string): Promise<number> => {
    const { rows } = await pool.query<{ expires_at: Date }>(
      `SELECT s.expires_at FROM auth_sessions s
         JOIN users u ON u.id = s.user_id
        WHERE u.email = $1 ORDER BY s.created_at DESC LIMIT 1`,
      [email],
    );
    return rows[0].expires_at.getTime();
  };

  it('ACC-02: refuses an unconfirmed account (403, asks to confirm)', async () => {
    const res = await login({ email: OWNER, password: PASSWORD });
    expect(res.status).toBe(403);
    expect((res.body as { message: string }).message).toMatch(
      /confirm your email/i,
    );
  });

  it('confirms the email so the owner can sign in', async () => {
    const { rows } = await pool.query<{ url: string }>(
      `SELECT payload->>'verifyUrl' url FROM outbox_events
       WHERE routing_key = 'identity.email_verification_requested'
         AND payload->>'email' = $1 ORDER BY id ASC LIMIT 1`,
      [OWNER],
    );
    const token = new URL(rows[0].url).searchParams.get('token');
    await request(server).post('/api/v1/auth/verify-email').send({ token });
    expect((await login({ email: OWNER, password: PASSWORD })).status).toBe(
      200,
    );
  });

  it('ACC-02: a fresh confirmation email was queued on the unconfirmed attempt', async () => {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*) n FROM outbox_events
       WHERE routing_key = 'identity.email_verification_requested'
         AND payload->>'email' = $1`,
      [OWNER],
    );
    // one from register + at least one from the unconfirmed sign-in attempt
    expect(Number(rows[0].n)).toBeGreaterThanOrEqual(2);
  });

  it('ACC-02: refuses a suspended account (403)', async () => {
    const res = await login({ email: SUSPENDED, password: PASSWORD });
    expect(res.status).toBe(403);
    expect((res.body as { message: string }).message).toMatch(/suspended/i);
  });

  it('ACC-08: "remember me" grants a much longer session than without', async () => {
    await login({ email: OWNER, password: PASSWORD, rememberMe: false });
    const shortExpiry = await latestSessionExpiry(OWNER);
    await login({ email: OWNER, password: PASSWORD, rememberMe: true });
    const longExpiry = await latestSessionExpiry(OWNER);
    // remembered session outlives the short one by well over a day
    expect(longExpiry - shortExpiry).toBeGreaterThan(2 * 24 * 60 * 60 * 1000);
  });

  it('ACC-03: an attendee signs in on the attendee audience', async () => {
    const res = await login({
      email: ATTENDEE,
      password: PASSWORD,
      persona: 'attendee',
      orgSlug: undefined, // attendees have no workspace (US-DISC-08)
    });
    expect(res.status).toBe(200);
    expect(
      (res.body as { data: { user: { persona: string } } }).data.user.persona,
    ).toBe('attendee');
  });

  it('ACC-03: an organizer email at attendee sign-in fails neutrally (401)', async () => {
    const res = await login({
      email: OWNER,
      password: PASSWORD,
      persona: 'attendee',
      orgSlug: undefined,
    });
    expect(res.status).toBe(401);
  });

  it('ACC-11: an attendee token cannot reach an organizer console route (403)', async () => {
    const res = await login({
      email: ATTENDEE,
      password: PASSWORD,
      persona: 'attendee',
      orgSlug: undefined,
    });
    const attendeeToken = (res.body as { data: { accessToken: string } }).data
      .accessToken;
    const admin = await request(server)
      .get('/api/v1/events')
      .set('Authorization', `Bearer ${attendeeToken}`);
    expect(admin.status).toBe(403);
  });

  /** Attendee accounts live in the platform org (US-DISC-08). */
  async function seedAttendee(email: string, pwHash: string): Promise<void> {
    const platform = await pool.query<{ id: string }>(
      `SELECT id FROM organizations WHERE slug = 'eventa'`,
    );
    await pool.query(
      `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
       VALUES ($1, 'Seed', $2, 'attendee', 'Active', $3)`,
      [Number(platform.rows[0].id), email, pwHash],
    );
  }

  async function seedUser(
    email: string,
    persona: string,
    status: string,
    pwHash: string,
  ): Promise<void> {
    await pool.query(
      `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
       VALUES ($1, 'Seed', $2, $3, $4, $5)`,
      [orgId, email, persona, status, pwHash],
    );
  }
});

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM audit_events WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug LIKE 'signin-co%')`,
  );
  // The attendee user lives in the shared platform org — remove it by email.
  await pool.query(
    `DELETE FROM outbox_events WHERE aggregate_id IN
       (SELECT id::text FROM users WHERE email = $1)`,
    [ATTENDEE],
  );
  await pool.query(`DELETE FROM users WHERE email = $1`, [ATTENDEE]);
  await pool.query(`DELETE FROM organizations WHERE slug LIKE 'signin-co%'`);
}
