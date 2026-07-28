process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://eventa:eventa@localhost:5432/eventa';
process.env.JWT_SECRET ??= 'test-secret-at-least-16-characters-long';

import type { Server } from 'node:http';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const SLUG = 'acme-auth-test';
const EMAIL = 'admin@acme-auth.test';
const PASSWORD = 'correct horse battery staple';

interface Envelope {
  error: { code: string; message: string };
}
interface LoginBody {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  user: { email: string; permissions: string[] };
}

describe('Auth (e2e, JWT + passport)', () => {
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
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
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

  const loginData = async (): Promise<LoginBody> =>
    ((await login()).body as { data: LoginBody }).data;

  it('rejects a bad password with a 401 error envelope', async () => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: EMAIL, password: 'wrong-password', orgSlug: SLUG });
    expect(res.status).toBe(401);
    expect((res.body as Envelope).error.code).toBe('UNAUTHORIZED');
  });

  it('rejects an unknown org/user uniformly with 401', async () => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: EMAIL, password: PASSWORD, orgSlug: 'no-such-org' });
    expect(res.status).toBe(401);
  });

  it('logs in and returns { data } with an access + refresh token pair', async () => {
    const res = await login();
    expect(res.status).toBe(200);
    const body = (res.body as { data: LoginBody }).data;
    expect(body.tokenType).toBe('Bearer');
    expect(typeof body.accessToken).toBe('string');
    expect(typeof body.refreshToken).toBe('string');
    expect(body.expiresIn).toBeGreaterThan(0);
    expect(body.user.email).toBe(EMAIL);
    expect(body.user.permissions).toEqual(
      expect.arrayContaining(['setUsers', 'setSettings']),
    );
  });

  it('rejects /auth/me without a Bearer token', async () => {
    const res = await request(server).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('accepts /auth/me with a Bearer access token', async () => {
    const { accessToken } = await loginData();
    const res = await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect((res.body as { data: { email: string } }).data.email).toBe(EMAIL);
  });

  it('exchanges a refresh token for a new access token', async () => {
    const { refreshToken } = await loginData();
    const res = await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });
    expect(res.status).toBe(200);
    expect(
      typeof (res.body as { data: { accessToken: string } }).data.accessToken,
    ).toBe('string');
  });

  it('logout revokes the refresh session', async () => {
    const { accessToken, refreshToken } = await loginData();

    await request(server)
      .delete('/api/v1/session')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);

    await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(401);
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
