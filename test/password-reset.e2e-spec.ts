process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://eventa:eventa@localhost:5432/eventa';
process.env.JWT_SECRET ??= 'test-secret-at-least-16-characters-long';

import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { buildValidationPipe } from '../src/common/http/validation';
import { listenOnLoopback } from './support/loopback';

const OLD_PASSWORD = 'oldpass1word';
const NEW_PASSWORD = 'newpass2word';
const OWNER = 'reset-owner@reset-e2e.test';
const ORG_SLUG = 'reset-co';
/**
 * A workspace slug that matches the prefix the reset form once put on its own
 * throttle identity. Sign-in accepts any slug-shaped string and counts a miss
 * against it whether or not the workspace exists.
 */
const COLLIDING_SLUG = 'forgot';
const SIGN_IN_MAX_ATTEMPTS = 5; // LOGIN_MAX_ATTEMPTS' default
/** A second workspace the owner's address also has accounts in. */
const WORKSPACE_B = { name: 'Reset Co B', slug: 'reset-co-b' };
const WORKSPACE_GONE = { name: 'Reset Co Gone', slug: 'reset-co-gone' };
const LINKEDIN_ONLY = 'reset-linkedin@reset-e2e.test';
const INVITEE = 'reset-invitee@reset-e2e.test';
const collidingSignInKeys = [
  `login:fail:${COLLIDING_SLUG}|admin|${OWNER}`,
  `login:lock:${COLLIDING_SLUG}|admin|${OWNER}`,
];

interface Body<T> {
  data: T;
}

describe('Forgotten-password reset (US-ACC-04, e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let redis: Redis;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    redis = new Redis();
    await cleanup(pool);
    await redis.del(...collidingSignInKeys);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await listenOnLoopback(app);
    server = app.getHttpServer() as Server;

    await registerAndConfirm();
  });

  afterAll(async () => {
    await cleanup(pool);
    await redis.del(...collidingSignInKeys);
    await redis.quit();
    await pool.end();
    await app.close();
  });

  const login = (password: string) =>
    request(server)
      .post('/api/v1/auth/login')
      .send({ email: OWNER, password, orgSlug: ORG_SLUG, persona: 'admin' });

  const tokenFrom = async (routingKey: string): Promise<string> => {
    const { rows } = await pool.query<{ url: string }>(
      `SELECT COALESCE(payload->>'resetUrl', payload->>'verifyUrl') url
         FROM outbox_events
        WHERE routing_key = $1 AND payload->>'email' = $2
        ORDER BY id DESC LIMIT 1`,
      [routingKey, OWNER],
    );
    return new URL(rows[0].url).searchParams.get('token') ?? '';
  };

  async function registerAndConfirm(): Promise<void> {
    await request(server).post('/api/v1/auth/register').send({
      name: 'Reset Owner',
      email: OWNER,
      password: OLD_PASSWORD,
      organizationName: 'Reset Co',
      acceptTerms: true,
    });
    const token = await tokenFrom('identity.email_verification_requested');
    await request(server).post('/api/v1/auth/verify-email').send({ token });
  }

  it('emails a reset link to an account that exists', async () => {
    const known = await request(server)
      .post('/api/v1/auth/forgot-password')
      .send({ email: OWNER });

    expect(known.status).toBe(200);
    expect(await tokenFrom('identity.password_reset_requested')).not.toBe('');
  });

  it('says plainly when no account uses the address', async () => {
    // A deliberate product decision (a14cd8f): silence for an address with no
    // account reads as a mail that was sent and lost. The cost — the endpoint
    // confirms whether an account exists — is bounded by the sign-in throttle,
    // which counts each miss.
    // A fresh address every run: each miss counts against the throttle, which
    // outlives the run, so a fixed one is locked (429) after a few runs.
    const unknown = await request(server)
      .post('/api/v1/auth/forgot-password')
      .send({ email: `nobody-${Date.now()}@reset-e2e.test` });

    expect(unknown.status).toBe(404);
    expect((unknown.body as { message: string }).message).toMatch(
      /No organizer account uses that email address/,
    );
  });

  it('sets the new password; the old one stops working', async () => {
    const token = await tokenFrom('identity.password_reset_requested');
    const res = await request(server)
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);

    expect((await login(OLD_PASSWORD)).status).toBe(401);
    expect((await login(NEW_PASSWORD)).status).toBe(200);
  });

  it('rejects reusing a single-use link (fingerprint changed) with 422', async () => {
    // The same token from the previous test — the password already changed.
    const token = await tokenFrom('identity.password_reset_requested');
    const res = await request(server)
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword: 'another3pass' });
    expect(res.status).toBe(422);
  });

  it('rejects setting the same password again (422)', async () => {
    await request(server)
      .post('/api/v1/auth/forgot-password')
      .send({ email: OWNER });
    const token = await tokenFrom('identity.password_reset_requested');
    const res = await request(server)
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword: NEW_PASSWORD }); // == current
    expect(res.status).toBe(422);
  });

  /**
   * Failed sign-ins must never lock the reset form. They once did whenever the
   * sign-in identity spelled the same string as the reset one — which anybody
   * could arrange by naming the workspace "forgot", without an account of their
   * own, for any address, every cool-off.
   */
  it('is not locked by failed sign-ins, whatever workspace they named', async () => {
    for (let i = 0; i < SIGN_IN_MAX_ATTEMPTS; i += 1) {
      await request(server).post('/api/v1/auth/login').send({
        email: OWNER,
        password: 'wrong-password1',
        orgSlug: COLLIDING_SLUG,
        persona: 'admin',
      });
    }

    const res = await request(server)
      .post('/api/v1/auth/forgot-password')
      .send({ email: OWNER });

    expect(res.status).toBe(200);
  });

  /**
   * The lookup behind the form weighs every account on the address, joined to
   * its workspace and its social links — proved here against Postgres rather
   * than a mock, because the join and the fold are where it could go wrong.
   */
  describe('accounts in more than one workspace', () => {
    let workspaceB: number;

    beforeAll(async () => {
      workspaceB = await seedWorkspace(pool, WORKSPACE_B);
      const gone = await seedWorkspace(pool, WORKSPACE_GONE);
      await pool.query(
        `UPDATE organizations SET deleted_at = now() WHERE id = $1`,
        [gone],
      );
      // The owner, invited into B and not yet accepted: no password there.
      await seedAccount(pool, workspaceB, OWNER, 'Invited');
      // And an active account with a password in a deleted workspace.
      await seedAccount(pool, gone, OWNER, 'Active', 'argon2-unused');
    });

    const resetEventsSince = async (sinceId: number) =>
      (
        await pool.query<{ userId: string; workspaceName: string | null }>(
          `SELECT payload->>'userId' "userId",
                  payload->>'workspaceName' "workspaceName"
             FROM outbox_events
            WHERE routing_key = 'identity.password_reset_requested'
              AND payload->>'email' = $1 AND id > $2
            ORDER BY id`,
          [OWNER, sinceId],
        )
      ).rows;

    it('sends the owner one link, for the workspace they can sign in to', async () => {
      const since = await lastOutboxId(pool);

      const res = await request(server)
        .post('/api/v1/auth/forgot-password')
        .send({ email: OWNER });

      expect(res.status).toBe(200);
      const { rows } = await pool.query<{ id: string }>(
        `SELECT u.id FROM users u JOIN organizations o ON o.id = u.organization_id
          WHERE o.slug = $1 AND u.email = $2`,
        [ORG_SLUG, OWNER],
      );
      expect(await resetEventsSince(since)).toEqual([
        { userId: rows[0].id, workspaceName: 'Reset Co' },
      ]);
    });

    it('tells an invitee with no password about the invitation', async () => {
      await seedAccount(pool, workspaceB, INVITEE, 'Invited');
      const res = await request(server)
        .post('/api/v1/auth/forgot-password')
        .send({ email: INVITEE });

      expect(res.status).toBe(422);
      expect((res.body as { message: string }).message).toMatch(/invitation/);
    });

    it('sends a LinkedIn-only account to LinkedIn, not Google', async () => {
      const userId = await seedAccount(
        pool,
        workspaceB,
        LINKEDIN_ONLY,
        'Active',
      );
      await pool.query(
        `INSERT INTO social_identities (organization_id, user_id, provider, subject, email)
         VALUES ($1, $2, 'linkedin', $3, $4)`,
        [workspaceB, userId, `li-${userId}`, LINKEDIN_ONLY],
      );

      const res = await request(server)
        .post('/api/v1/auth/forgot-password')
        .send({ email: LINKEDIN_ONLY });

      expect(res.status).toBe(422);
      const { message } = res.body as { message: string };
      expect(message).toMatch(/Continue with LinkedIn/);
      expect(message).not.toMatch(/Google/);
    });
  });
});

async function seedWorkspace(
  pool: Pool,
  workspace: { name: string; slug: string },
): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
    [workspace.name, workspace.slug],
  );
  return Number(rows[0].id);
}

async function seedAccount(
  pool: Pool,
  organizationId: number,
  email: string,
  status: string,
  passwordHash: string | null = null,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
     VALUES ($1, 'Reset Seed', $2, 'admin', $3, $4) RETURNING id`,
    [organizationId, email, status, passwordHash],
  );
  return rows[0].id;
}

async function lastOutboxId(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ id: string | null }>(
    `SELECT max(id) id FROM outbox_events`,
  );
  return Number(rows[0].id ?? 0);
}

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM audit_events WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug LIKE 'reset-co%')`,
  );
  await pool.query(`DELETE FROM organizations WHERE slug LIKE 'reset-co%'`);
}
