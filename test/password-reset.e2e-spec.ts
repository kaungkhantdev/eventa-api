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
const OWNER = 'reset-owner@reset-e2e.test';
const ORG_SLUG = 'reset-co';

interface Body<T> {
  data: T;
}

describe('Forgotten-password reset (US-ACC-04, e2e)', () => {
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

    await registerAndConfirm();
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

  it('emails a reset link and never reveals whether the email exists', async () => {
    const known = await request(server)
      .post('/api/v1/auth/forgot-password')
      .send({ email: OWNER });
    const unknown = await request(server)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'nobody@reset-e2e.test' });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect((known.body as Body<{ message: string }>).data.message).toBe(
      (unknown.body as Body<{ message: string }>).data.message,
    );
    expect(await tokenFrom('identity.password_reset_requested')).not.toBe('');
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
});

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM audit_events WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug LIKE 'reset-co%')`,
  );
  await pool.query(`DELETE FROM organizations WHERE slug LIKE 'reset-co%'`);
}
