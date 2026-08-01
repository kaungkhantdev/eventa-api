process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://eventa:eventa@localhost:5432/eventa';
process.env.JWT_SECRET ??= 'test-secret-at-least-16-characters-long';
process.env.LOGIN_MAX_ATTEMPTS = '3';

import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { buildValidationPipe } from '../src/common/http/validation';

const PASSWORD = 'lockpass1word';
const OWNER = 'lockout-owner@lockout-e2e.test';
const GHOST = 'ghost@lockout-e2e.test';
const OTHER = 'other@lockout-e2e.test';
const ORG_SLUG = 'lockout-co';

const identity = (email: string) => `${ORG_SLUG}|admin|${email}`;

describe('Sign-in brute-force lockout (US-ACC-12, e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let redis: Redis;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    redis = new Redis();
    await cleanup(pool, redis);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();
    server = app.getHttpServer() as Server;

    await request(server).post('/api/v1/auth/register').send({
      name: 'Lockout Owner',
      email: OWNER,
      password: PASSWORD,
      organizationName: 'Lockout Co',
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
    await cleanup(pool, redis);
    await pool.end();
    await redis.quit();
    await app.close();
  });

  const login = (email: string, password: string) =>
    request(server)
      .post('/api/v1/auth/login')
      .send({ email, password, orgSlug: ORG_SLUG, persona: 'admin' });

  it('locks the account (429) after 3 wrong attempts — even a correct password is refused', async () => {
    for (let i = 0; i < 3; i += 1) {
      expect((await login(OWNER, 'wrong-password')).status).toBe(401);
    }
    // Now locked: the correct password is still refused with 429.
    expect((await login(OWNER, PASSWORD)).status).toBe(429);
  });

  it('does not lock a different identity (per-account, not global)', async () => {
    expect((await login(OTHER, 'wrong-password')).status).toBe(401);
  });

  it('locks a non-existent account the same way (no enumeration)', async () => {
    for (let i = 0; i < 3; i += 1) {
      expect((await login(GHOST, 'wrong-password')).status).toBe(401);
    }
    expect((await login(GHOST, 'whatever')).status).toBe(429);
  });
});

async function cleanup(pool: Pool, redis: Redis): Promise<void> {
  await pool.query(
    `DELETE FROM audit_events WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug LIKE 'lockout-co%')`,
  );
  await pool.query(`DELETE FROM organizations WHERE slug LIKE 'lockout-co%'`);
  for (const email of [OWNER, GHOST, OTHER]) {
    await redis.del(
      `login:fail:${identity(email)}`,
      `login:lock:${identity(email)}`,
    );
  }
}
