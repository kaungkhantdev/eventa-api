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

const SLUG = 'acme-auth-test';
const EMAIL = 'admin@acme-auth.test';
const PASSWORD = 'correct horse battery staple';

interface SuccessBody<T> {
  success: boolean;
  statusCode: number;
  message: string;
  data: T;
  timestamp: string;
}
interface FailureBody {
  success: boolean;
  statusCode: number;
  message: string;
  errors?: { field: string; message: string }[];
}
interface LoginData {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  user: { email: string; permissions: string[] };
}

describe('Auth (e2e — envelope + passport)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let orgId: number;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    orgId = await seed(pool);

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
    await pool.query(`DELETE FROM audit_events WHERE organization_id = $1`, [
      orgId,
    ]);
    await pool.query(`DELETE FROM organizations WHERE slug = $1`, [SLUG]);
    await pool.end();
    await app.close();
  });

  const login = () =>
    request(server)
      .post('/api/v1/auth/login')
      .send({ email: EMAIL, password: PASSWORD, orgSlug: SLUG });

  const loginData = async (): Promise<LoginData> =>
    ((await login()).body as SuccessBody<LoginData>).data;

  const countOutbox = async (): Promise<number> => {
    const r = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox_events WHERE organization_id=$1 AND routing_key='identity.signed_in'`,
      [orgId],
    );
    return r.rows[0].n;
  };

  it('rejects a bad password with the 401 failure envelope', async () => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: EMAIL, password: 'wrong-password', orgSlug: SLUG });
    expect(res.status).toBe(401);
    const body = res.body as FailureBody;
    expect(body.success).toBe(false);
    expect(body.statusCode).toBe(401);
    expect(typeof body.message).toBe('string');
  });

  it('returns a structured validation error envelope', async () => {
    const res = await request(server).post('/api/v1/auth/login').send({});
    expect(res.status).toBe(400);
    const body = res.body as FailureBody;
    expect(body.success).toBe(false);
    expect(body.message).toBe('Validation failed.');
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors?.[0]).toHaveProperty('field');
    expect(body.errors?.[0]).toHaveProperty('message');
  });

  it('logs in and returns the success envelope with tokens', async () => {
    const res = await login();
    expect(res.status).toBe(200);
    const body = res.body as SuccessBody<LoginData>;
    expect(body.success).toBe(true);
    expect(body.statusCode).toBe(200);
    expect(body.message).toBe('Signed in successfully.');
    expect(typeof body.timestamp).toBe('string');
    expect(body.data.tokenType).toBe('Bearer');
    expect(typeof body.data.accessToken).toBe('string');
    expect(typeof body.data.refreshToken).toBe('string');
    expect(body.data.user.email).toBe(EMAIL);
    expect(body.data.user.permissions).toEqual(
      expect.arrayContaining(['setUsers', 'setSettings']),
    );
    // sign-in side effect is enqueued to the transactional outbox (the worker
    // consumes it and writes the audit), not written inline on the request path.
    expect(await countOutbox()).toBeGreaterThan(0);
  });

  it('rejects /auth/me without a Bearer token', async () => {
    const res = await request(server).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect((res.body as FailureBody).success).toBe(false);
  });

  it('accepts /auth/me with a Bearer access token', async () => {
    const { accessToken } = await loginData();
    const res = await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect((res.body as SuccessBody<{ email: string }>).data.email).toBe(EMAIL);
  });

  it('exchanges a refresh token for a new access token', async () => {
    const { refreshToken } = await loginData();
    const res = await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });
    expect(res.status).toBe(200);
    expect(
      typeof (res.body as SuccessBody<{ accessToken: string }>).data
        .accessToken,
    ).toBe('string');
  });

  it('logout returns 200 with data:null and revokes the refresh session', async () => {
    const { accessToken, refreshToken } = await loginData();

    const out = await request(server)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(out.status).toBe(200);
    const body = out.body as SuccessBody<null>;
    expect(body.success).toBe(true);
    expect(body.data).toBeNull();

    await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(401);
  });

  /**
   * The workspace slug is generated at sign-up and shown nowhere, so sign-in
   * stopped asking for it (US-ACC-02). The password resolves the workspace.
   */
  describe('signing in without naming a workspace', () => {
    const loginWithout = (password: string) =>
      request(server)
        .post('/api/v1/auth/login')
        .send({ email: EMAIL, password });

    it('signs in on email and password alone', async () => {
      const res = await loginWithout(PASSWORD);

      expect(res.status).toBe(200);
      const data = (res.body as SuccessBody<LoginData>).data;
      expect(data.accessToken).toEqual(expect.any(String));
      expect(data.user.email).toBe(EMAIL);
    });

    // Identical to the refusal an unknown address gets: no workspace is named,
    // so this cannot be used to ask which workspaces an address belongs to.
    it('refuses a wrong password without naming a workspace', async () => {
      const res = await loginWithout('not the password');

      expect(res.status).toBe(401);
      expect(JSON.stringify(res.body)).not.toContain(SLUG);
    });
  });
});

async function seed(pool: Pool): Promise<number> {
  await pool.query(
    `DELETE FROM audit_events WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug = $1)`,
    [SLUG],
  );
  await pool.query(`DELETE FROM organizations WHERE slug = $1`, [SLUG]);

  const org = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ('Acme Auth', $1) RETURNING id`,
    [SLUG],
  );
  const orgId = Number(org.rows[0].id);

  await pool.query(
    `INSERT INTO permissions (key, "group", label) VALUES
       ('setUsers','Settings','Manage team'),
       ('setSettings','Settings','Manage settings')
     ON CONFLICT (key) DO NOTHING`,
  );
  const role = await pool.query<{ id: string }>(
    `INSERT INTO roles (organization_id, name, description) VALUES ($1,'Admin','Full access') RETURNING id`,
    [orgId],
  );
  const roleId = Number(role.rows[0].id);
  await pool.query(
    `INSERT INTO role_permissions (role_id, permission_key, granted) VALUES
       ($1,'setUsers',true), ($1,'setSettings',true)`,
    [roleId],
  );

  const pwHash = await hash(PASSWORD);
  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
     VALUES ($1,'Admin',$2,'admin','Active',$3) RETURNING id`,
    [orgId, EMAIL, pwHash],
  );
  await pool.query(
    `INSERT INTO memberships (organization_id, user_id, role_id, role, status)
     VALUES ($1,$2,$3,'Admin','Active')`,
    [orgId, user.rows[0].id, roleId],
  );
  return orgId;
}
