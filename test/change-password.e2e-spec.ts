process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://eventa:eventa@localhost:5432/eventa';
process.env.JWT_SECRET ??= 'test-secret-at-least-16-characters-long';

import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { buildValidationPipe } from '../src/common/http/validation';
import { listenOnLoopback } from './support/loopback';

const OLD_PASSWORD = 'oldpass1word';
const NEW_PASSWORD = 'newpass2word';
const THIRD_PASSWORD = 'thirdpass3word';
const FOURTH_PASSWORD = 'fourthpass4word';
const OWNER = 'change-owner@change-e2e.test';
const ORG_SLUG = 'change-co';

/** Routing key of the confirmation the change queues (US-DISC-12 AC4). */
const PASSWORD_CHANGED = 'identity.password_changed';

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

/** The outbox payload the worker will read — asserted field by field. */
interface NoticePayload {
  version: number;
  organizationId: number;
  userId: string;
  name: string;
  email: string;
  otherSessionsSignedOut: number;
  occurredAt: string;
}

describe('Change password while signed in (US-ACC-05, e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await listenOnLoopback(app);
    server = app.getHttpServer() as Server;

    await request(server).post('/api/v1/auth/register').send({
      name: 'Change Owner',
      email: OWNER,
      password: OLD_PASSWORD,
      organizationName: 'Change Co',
      acceptTerms: true,
    });
    const { rows } = await pool.query<{ url: string }>(
      `SELECT payload->>'verifyUrl' url FROM outbox_events
       WHERE routing_key = 'identity.email_verification_requested'
         AND payload->>'email' = $1`,
      [OWNER],
    );
    const token = new URL(rows[0].url).searchParams.get('token');
    await request(server).post('/api/v1/auth/verify-email').send({ token });
  });

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  const login = (password: string) =>
    request(server)
      .post('/api/v1/auth/login')
      .send({ email: OWNER, password, orgSlug: ORG_SLUG, persona: 'admin' });

  const tokensOf = async (password: string): Promise<Tokens> => {
    const res = await login(password);
    return (res.body as { data: Tokens }).data;
  };

  const refresh = (refreshToken: string) =>
    request(server).post('/api/v1/auth/refresh').send({ refreshToken });

  const changePassword = (accessToken: string, body: Record<string, unknown>) =>
    request(server)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(body);

  /** The confirmation notices queued for this account since `sinceId`. */
  const noticesSince = async (sinceId: number): Promise<NoticePayload[]> => {
    const { rows } = await pool.query<{ payload: NoticePayload }>(
      `SELECT payload FROM outbox_events
        WHERE routing_key = $1 AND payload->>'email' = $2 AND id > $3
        ORDER BY id`,
      [PASSWORD_CHANGED, OWNER, sinceId],
    );
    return rows.map((row) => row.payload);
  };

  /** Unrevoked sessions this account holds right now. */
  const liveSessions = async (): Promise<number> => {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*) n FROM auth_sessions s
         JOIN users u ON u.id = s.user_id
        WHERE u.email = $1 AND s.revoked_at IS NULL`,
      [OWNER],
    );
    return Number(rows[0].n);
  };

  it('changes the password, keeps this device, signs the others out', async () => {
    const deviceA = await tokensOf(OLD_PASSWORD);
    const deviceB = await tokensOf(OLD_PASSWORD);

    const res = await changePassword(deviceA.accessToken, {
      currentPassword: OLD_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(res.status).toBe(200);

    // The other device is signed out; this device stays signed in.
    expect((await refresh(deviceB.refreshToken)).status).toBe(401);
    expect((await refresh(deviceA.refreshToken)).status).toBe(200);

    // New password works; the old one no longer does.
    expect((await login(NEW_PASSWORD)).status).toBe(200);
    expect((await login(OLD_PASSWORD)).status).toBe(401);
  });

  /**
   * US-DISC-12 criterion 4's middle clause. A password change nobody is told
   * about is how a stolen session becomes a permanent one, so the notice is not
   * a nicety: it is the only signal the owner gets.
   */
  describe('the change announces itself', () => {
    it('queues one confirmation naming the devices it signed out', async () => {
      const since = await lastOutboxId(pool);
      const deviceA = await tokensOf(NEW_PASSWORD);
      await tokensOf(NEW_PASSWORD); // a second device, to be signed out
      const others = (await liveSessions()) - 1; // every session but deviceA's

      const res = await changePassword(deviceA.accessToken, {
        currentPassword: NEW_PASSWORD,
        newPassword: THIRD_PASSWORD,
      });
      expect(res.status).toBe(200);

      const [notice, ...extra] = await noticesSince(since);
      expect(extra).toEqual([]);
      expect(notice).toMatchObject({
        version: 1,
        email: OWNER,
        name: 'Change Owner',
        otherSessionsSignedOut: others,
      });
      expect(others).toBeGreaterThan(0);
      expect(Date.parse(notice.occurredAt)).not.toBeNaN();
    });

    it('carries no password, hash or token for the worker to leak', async () => {
      const since = await lastOutboxId(pool);
      const device = await tokensOf(THIRD_PASSWORD);

      const res = await changePassword(device.accessToken, {
        currentPassword: THIRD_PASSWORD,
        newPassword: FOURTH_PASSWORD,
      });
      expect(res.status).toBe(200);

      const [notice] = await noticesSince(since);
      expect(Object.keys(notice).sort()).toEqual([
        'email',
        'name',
        'occurredAt',
        'organizationId',
        'otherSessionsSignedOut',
        'userId',
        'version',
      ]);
      expect(JSON.stringify(notice)).not.toContain(THIRD_PASSWORD);
      expect(JSON.stringify(notice)).not.toContain(FOURTH_PASSWORD);
    });
  });

  it('refuses (403) when the current password is wrong', async () => {
    const since = await lastOutboxId(pool);
    const device = await tokensOf(FOURTH_PASSWORD);
    const res = await changePassword(device.accessToken, {
      currentPassword: 'totally-wrong',
      newPassword: 'yetanother3pass',
    });
    expect(res.status).toBe(403);
    // Nothing changed, so nothing is announced — a confirmation for a change
    // that never happened would teach its reader to ignore the real one.
    expect(await noticesSince(since)).toEqual([]);
  });

  it('rejects (422) a new password equal to the current one', async () => {
    const since = await lastOutboxId(pool);
    const device = await tokensOf(FOURTH_PASSWORD);
    const res = await changePassword(device.accessToken, {
      currentPassword: FOURTH_PASSWORD,
      newPassword: FOURTH_PASSWORD,
    });
    expect(res.status).toBe(422);
    expect(await noticesSince(since)).toEqual([]);
  });

  it('requires authentication (401)', async () => {
    const res = await request(server)
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: NEW_PASSWORD, newPassword: 'brandnew9pass' });
    expect(res.status).toBe(401);
  });
});

async function lastOutboxId(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ id: string | null }>(
    `SELECT max(id) id FROM outbox_events`,
  );
  return Number(rows[0].id ?? 0);
}

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM audit_events WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug LIKE 'change-co%')`,
  );
  await pool.query(`DELETE FROM organizations WHERE slug LIKE 'change-co%'`);
}
