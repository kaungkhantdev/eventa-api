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
import { generateTotp } from '../src/common/crypto/totp';
import { buildValidationPipe } from '../src/common/http/validation';

const PASSWORD = 'correct horse battery staple';
/** Unique per run — deliberate failures leave throttle strikes in Redis. */
const ANAN = `anan-${Date.now()}@twofa.test`;

interface Success<T> {
  data: T;
}
interface LoginBody {
  twoFactorRequired: boolean;
  challengeToken?: string;
  accessToken?: string;
}

describe('Two-factor sign-in (e2e — US-ACC-05 / US-DISC-12)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let secret: string;
  let recoveryCodes: string[];

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    await pool.query(
      `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
       SELECT id, 'Anan', $1, 'attendee', 'Active', $2
       FROM organizations WHERE slug = 'eventa'`,
      [ANAN, await hash(PASSWORD)],
    );

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

  const login = async (): Promise<LoginBody> => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: ANAN, password: PASSWORD, persona: 'attendee' });
    expect(res.status).toBe(200);
    return (res.body as Success<LoginBody>).data;
  };

  const completeChallenge = (challengeToken: string, code: string) =>
    request(server)
      .post('/api/v1/auth/two-factor')
      .send({ challengeToken, code });

  const me = (jwt: string) =>
    request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${jwt}`);

  it('enrols: scan, confirm a code, pocket the recovery codes', async () => {
    const first = await login();
    expect(first.twoFactorRequired).toBe(false);
    const jwt = first.accessToken as string;

    const started = await request(server)
      .post('/api/v1/me/two-factor/start')
      .set('Authorization', `Bearer ${jwt}`);
    expect(started.status).toBe(200);
    secret = (started.body as Success<{ secret: string }>).data.secret;

    const confirmed = await request(server)
      .post('/api/v1/me/two-factor/confirm')
      .set('Authorization', `Bearer ${jwt}`)
      .send({ code: generateTotp(secret) });
    expect(confirmed.status).toBe(200);
    recoveryCodes = (confirmed.body as Success<{ recoveryCodes: string[] }>)
      .data.recoveryCodes;
    expect(recoveryCodes.length).toBeGreaterThanOrEqual(8);
  });

  it('the next sign-in demands a code and hands over NO session', async () => {
    const res = await login();
    expect(res.twoFactorRequired).toBe(true);
    expect(res.challengeToken).toBeTruthy();
    expect(res.accessToken).toBeUndefined();
  });

  it('a wrong code is refused and opens nothing', async () => {
    const { challengeToken } = await login();
    const res = await completeChallenge(challengeToken as string, '000000');
    expect(res.status).toBe(401);
  });

  it('the authenticator code completes the sign-in', async () => {
    const { challengeToken } = await login();
    const res = await completeChallenge(
      challengeToken as string,
      generateTotp(secret),
    );
    expect(res.status).toBe(200);
    const body = (res.body as Success<LoginBody & { accessToken: string }>)
      .data;
    expect(body.accessToken).toBeTruthy();
    expect((await me(body.accessToken)).status).toBe(200);
  });

  it('a recovery code works exactly once', async () => {
    const code = recoveryCodes[0];
    const first = await login();
    const used = await completeChallenge(first.challengeToken as string, code);
    expect(used.status).toBe(200);

    const second = await login();
    const reused = await completeChallenge(
      second.challengeToken as string,
      code,
    );
    expect(reused.status).toBe(401);
  });

  it('an access token cannot impersonate a challenge token', async () => {
    // Complete a login to get a REAL access token…
    const { challengeToken } = await login();
    const session = await completeChallenge(
      challengeToken as string,
      generateTotp(secret),
    );
    const accessToken = (session.body as Success<{ accessToken: string }>).data
      .accessToken;
    // …then try to use it where the challenge belongs. The typ check refuses.
    const res = await completeChallenge(accessToken, generateTotp(secret));
    expect(res.status).toBe(401);
  });

  it('after disabling, a plain password signs in again', async () => {
    const { challengeToken } = await login();
    const session = await completeChallenge(
      challengeToken as string,
      generateTotp(secret),
    );
    const jwt = (session.body as Success<{ accessToken: string }>).data
      .accessToken;
    const disabled = await request(server)
      .post('/api/v1/me/two-factor/disable')
      .set('Authorization', `Bearer ${jwt}`)
      .send({ code: generateTotp(secret) });
    expect(disabled.status).toBe(200);

    const res = await login();
    expect(res.twoFactorRequired).toBe(false);
    expect(res.accessToken).toBeTruthy();
  });
});

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM outbox_events WHERE aggregate_id IN
       (SELECT id::text FROM users WHERE email LIKE '%@twofa.test')`,
  );
  await pool.query(`DELETE FROM users WHERE email LIKE '%@twofa.test'`);
}
