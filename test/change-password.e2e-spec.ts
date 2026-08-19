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

const OLD_PASSWORD = 'oldpass1word';
const NEW_PASSWORD = 'newpass2word';
const OWNER = 'change-owner@change-e2e.test';
const ORG_SLUG = 'change-co';

interface Tokens {
  accessToken: string;
  refreshToken: string;
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
    await app.init();
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

  it('refuses (403) when the current password is wrong', async () => {
    const device = await tokensOf(NEW_PASSWORD);
    const res = await changePassword(device.accessToken, {
      currentPassword: 'totally-wrong',
      newPassword: 'yetanother3pass',
    });
    expect(res.status).toBe(403);
  });

  it('rejects (422) a new password equal to the current one', async () => {
    const device = await tokensOf(NEW_PASSWORD);
    const res = await changePassword(device.accessToken, {
      currentPassword: NEW_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(res.status).toBe(422);
  });

  it('requires authentication (401)', async () => {
    const res = await request(server)
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: NEW_PASSWORD, newPassword: 'brandnew9pass' });
    expect(res.status).toBe(401);
  });
});

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM audit_events WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug LIKE 'change-co%')`,
  );
  await pool.query(`DELETE FROM organizations WHERE slug LIKE 'change-co%'`);
}
