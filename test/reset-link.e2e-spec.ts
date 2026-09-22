process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://eventa:eventa@localhost:5432/eventa';
process.env.JWT_SECRET ??= 'test-secret-at-least-16-characters-long';

import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { buildValidationPipe } from '../src/common/http/validation';
import { buildOpenApiDocument } from '../src/openapi';
import { listenOnLoopback } from './support/loopback';

const PASSWORD = 'oldpass1word';
const NEW_PASSWORD = 'newpass2word';
const WORKSPACE = 'Reset Link E2E';
const ORG_SLUG = 'reset-link-e2e';
const OWNER = 'owner@reset-link-e2e.test';
const ATTENDEE = 'fan@reset-link-e2e.test';
/** What a dead link is refused with — the reset endpoint's own words. */
const INVALID_LINK =
  'This reset link is invalid or has expired. Request a new one.';
/** The forgot-password form's lock for the owner (LoginThrottleService). */
const OWNER_RESET_LOCK = `reset:lock:admin|${OWNER}`;
const RESET_REQUESTED = 'identity.password_reset_requested';

interface ResetClaims {
  sub: string;
  org: number;
  pv: string;
  typ: string;
}

interface Envelope<T> {
  data: T;
}

/**
 * Checking a reset link without spending it (US-ACC-04 criterion 7,
 * TC-ACC-10 step 6): the reset page asks on open, so a dead link is refused
 * before anybody types a password, and a good one says whose sign-in it opens.
 */
describe('Checking a password-reset link (US-ACC-04, e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let redis: Redis;
  let ownerLink: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    redis = new Redis();
    await cleanup(pool);
    await redis.del(OWNER_RESET_LOCK);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await listenOnLoopback(app);
    server = app.getHttpServer() as Server;

    await registerAndConfirm();
    ownerLink = await requestLink(OWNER, 'admin');
  });

  afterAll(async () => {
    await cleanup(pool);
    await redis.del(OWNER_RESET_LOCK);
    await redis.quit();
    await pool.end();
    await app.close();
  });

  const check = (token: unknown) =>
    request(server).post('/api/v1/auth/reset-password/check').send({ token });

  const tokenFor = async (email: string, routingKey: string) => {
    const { rows } = await pool.query<{ url: string }>(
      `SELECT COALESCE(payload->>'resetUrl', payload->>'verifyUrl') url
         FROM outbox_events
        WHERE routing_key = $1 AND payload->>'email' = $2
        ORDER BY id DESC LIMIT 1`,
      [routingKey, email],
    );
    return new URL(rows[0].url).searchParams.get('token') ?? '';
  };

  async function registerAndConfirm(): Promise<void> {
    await request(server).post('/api/v1/auth/register').send({
      name: 'Reset Link Owner',
      email: OWNER,
      password: PASSWORD,
      organizationName: WORKSPACE,
      acceptTerms: true,
    });
    const token = await tokenFor(
      OWNER,
      'identity.email_verification_requested',
    );
    await request(server).post('/api/v1/auth/verify-email').send({ token });
  }

  async function requestLink(email: string, persona: string): Promise<string> {
    const res = await request(server)
      .post('/api/v1/auth/forgot-password')
      .send({ email, persona });
    expect(res.status).toBe(200);
    return tokenFor(email, RESET_REQUESTED);
  }

  /** The refusal carries the invalid-link words and nothing else. */
  function expectRefusedAsInvalid(res: request.Response): void {
    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      success: false,
      statusCode: 422,
      message: INVALID_LINK,
      timestamp: expect.any(String) as unknown,
    });
  }

  it('says a fresh organizer link opens the admin sign-in, and which workspace', async () => {
    const res = await check(ownerLink);

    expect(res.status).toBe(200);
    expect((res.body as Envelope<unknown>).data).toEqual({
      persona: 'admin',
      workspaceName: WORKSPACE,
    });
  });

  it('does not spend the link: it checks good a second time', async () => {
    expect((await check(ownerLink)).status).toBe(200);
  });

  /**
   * The throttle guards the form that confirms whether an address has an
   * account. A link reveals nothing about an address, so a locked form must
   * not stop somebody holding a good link from finishing.
   */
  it('is not held back while the forgot-password form is locked', async () => {
    await redis.set(OWNER_RESET_LOCK, '1', 'EX', 60);
    try {
      const forgot = await request(server)
        .post('/api/v1/auth/forgot-password')
        .send({ email: OWNER });
      expect(forgot.status).toBe(429); // the lock is real

      expect((await check(ownerLink)).status).toBe(200);
    } finally {
      await redis.del(OWNER_RESET_LOCK);
    }
  });

  it('still sets the new password with the link it checked', async () => {
    const res = await request(server)
      .post('/api/v1/auth/reset-password')
      .send({ token: ownerLink, newPassword: NEW_PASSWORD });

    expect(res.status).toBe(200);
  });

  it('refuses the link once it has been used, as the reset would', async () => {
    const onOpen = await check(ownerLink);
    const onSubmit = await request(server)
      .post('/api/v1/auth/reset-password')
      .send({ token: ownerLink, newPassword: 'another3pass' });

    expectRefusedAsInvalid(onOpen);
    expect((onSubmit.body as { message: string }).message).toBe(INVALID_LINK);
  });

  describe('a link that was never good', () => {
    const claimsOf = (token: string): ResetClaims => {
      const { sub, org, pv, typ } = new JwtService().decode<ResetClaims>(token);
      return { sub, org, pv, typ };
    };

    it('refuses something that is not a token at all', async () => {
      expectRefusedAsInvalid(await check('not-a-reset-token'));
    });

    it('refuses the right claims signed by somebody else', async () => {
      const stranger = new JwtService({
        secret: 'somebody-else-entirely-0123456789',
      });
      const forged = await stranger.signAsync(claimsOf(ownerLink));

      expectRefusedAsInvalid(await check(forged));
    });

    it('refuses a link past its expiry', async () => {
      const fresh = await requestLink(OWNER, 'admin');
      const ours = app.get(JwtService, { strict: false });
      const expired = await ours.signAsync(claimsOf(fresh), { expiresIn: -60 });

      expectRefusedAsInvalid(await check(expired));
      expect((await check(fresh)).status).toBe(200); // only the expiry differs
    });
  });

  /**
   * An attendee's account lives in the platform organization, which is never
   * named — seeded into this suite's workspace so the proof is that the
   * organization is withheld because of the persona, whatever it is called.
   */
  it('says an attendee link opens the portal sign-in, naming no workspace', async () => {
    await seedActiveAttendee(pool, ATTENDEE);
    const link = await requestLink(ATTENDEE, 'attendee');

    const res = await check(link);

    expect(res.status).toBe(200);
    expect((res.body as Envelope<unknown>).data).toEqual({
      persona: 'attendee',
      workspaceName: null,
    });
  });

  /** openapi.json is what eventa-web is written against. */
  it('is in the contract, with the token in the body and a nullable workspace', () => {
    const document = buildOpenApiDocument(app);
    const schemas = document.components?.schemas ?? {};

    expect(document.paths['/auth/reset-password/check']?.post).toBeDefined();
    expect(schemas.CheckResetLinkDto).toMatchObject({
      required: ['token'],
      properties: { token: { type: 'string' } },
    });
    expect(schemas.ResetLinkResponseDto).toMatchObject({
      required: ['persona', 'workspaceName'],
      properties: {
        persona: { enum: ['admin', 'attendee'] },
        workspaceName: { type: 'string', nullable: true },
      },
    });
  });
});

async function seedActiveAttendee(pool: Pool, email: string): Promise<void> {
  await pool.query(
    `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
     SELECT id, 'Reset Link Fan', $2, 'attendee', 'Active', 'argon2-seeded-hash'
       FROM organizations WHERE slug = $1`,
    [ORG_SLUG, email],
  );
}

async function cleanup(pool: Pool): Promise<void> {
  const ours = `${ORG_SLUG}%`;
  await pool.query(
    `DELETE FROM audit_events WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug LIKE $1)`,
    [ours],
  );
  await pool.query(`DELETE FROM organizations WHERE slug LIKE $1`, [ours]);
}
