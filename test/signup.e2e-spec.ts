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

const PASSWORD = 'strongpass1';
const OWNER = 'owner@signup-e2e.test';
const OTHER = 'pending@signup-e2e.test';
const SLUGS = ['acme-events', 'beta-co'];

interface Body<T> {
  data: T;
  message?: string;
}

describe('Organizer sign-up + email confirmation (US-ACC-01, e2e)', () => {
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
  });

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  const register = (body: Record<string, unknown>) =>
    request(server).post('/api/v1/auth/register').send(body);

  const login = (email: string, orgSlug: string) =>
    request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, orgSlug, persona: 'admin' });

  const userStatus = async (email: string): Promise<string | undefined> => {
    const { rows } = await pool.query<{ status: string }>(
      `SELECT status FROM users WHERE email = $1 AND persona = 'admin'`,
      [email],
    );
    return rows[0]?.status;
  };

  const verifyTokenFor = async (email: string): Promise<string> => {
    const { rows } = await pool.query<{ url: string }>(
      `SELECT payload->>'verifyUrl' url FROM outbox_events
       WHERE routing_key = 'identity.email_verification_requested'
         AND payload->>'email' = $1`,
      [email],
    );
    return new URL(rows[0].url).searchParams.get('token') ?? '';
  };

  it('registers an owner: 202, neutral message, account pending, verification queued', async () => {
    const res = await register({
      name: 'Owner One',
      email: OWNER,
      password: PASSWORD,
      organizationName: 'Acme Events',
      acceptTerms: true,
    });
    expect(res.status).toBe(202);
    expect((res.body as Body<{ message: string }>).data.message).toMatch(
      /check your inbox/i,
    );
    expect(await userStatus(OWNER)).toBe('Invited'); // not active until confirmed
    expect(await verifyTokenFor(OWNER)).not.toBe('');
  });

  it('refuses sign-in until the email is confirmed (403)', async () => {
    expect((await login(OWNER, 'acme-events')).status).toBe(403);
  });

  it('confirms the email, then the owner can sign in', async () => {
    const token = await verifyTokenFor(OWNER);
    const res = await request(server)
      .post('/api/v1/auth/verify-email')
      .send({ token });
    expect(res.status).toBe(200);
    expect(
      (res.body as Body<{ orgSlug: string; verified: boolean }>).data,
    ).toMatchObject({ verified: true, orgSlug: 'acme-events' });
    expect(await userStatus(OWNER)).toBe('Active');

    expect((await login(OWNER, 'acme-events')).status).toBe(200);
  });

  it('never reveals a taken email and creates no duplicate', async () => {
    const res = await register({
      name: 'Impostor',
      email: OWNER,
      password: PASSWORD,
      organizationName: 'Acme Events',
      acceptTerms: true,
    });
    expect(res.status).toBe(202); // same neutral acknowledgement
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*) n FROM users WHERE email = $1 AND persona = 'admin'`,
      [OWNER],
    );
    expect(Number(rows[0].n)).toBe(1); // still exactly one account
  });

  it('rejects a weak password (400)', async () => {
    const res = await register({
      name: 'Weak',
      email: OTHER,
      password: 'short',
      organizationName: 'Beta Co',
      acceptTerms: true,
    });
    expect(res.status).toBe(400);
  });

  it('requires accepting the Terms (400)', async () => {
    const res = await register({
      name: 'No Terms',
      email: OTHER,
      password: PASSWORD,
      organizationName: 'Beta Co',
      acceptTerms: false,
    });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid confirmation token (422)', async () => {
    const res = await request(server)
      .post('/api/v1/auth/verify-email')
      .send({ token: 'a.b.c' });
    expect(res.status).toBe(422);
  });
});

async function cleanup(pool: Pool): Promise<void> {
  const like = SLUGS.map((s) => `${s}%`);
  await pool.query(
    `DELETE FROM audit_events WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug LIKE ANY($1))`,
    [like],
  );
  await pool.query(`DELETE FROM organizations WHERE slug LIKE ANY($1)`, [like]);
}
