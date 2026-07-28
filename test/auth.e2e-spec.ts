process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://eventa:eventa@localhost:5432/eventa';

import type { Server } from 'node:http';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import cookieParser from 'cookie-parser';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const SLUG = 'acme-auth-test';
const EMAIL = 'admin@acme-auth.test';
const PASSWORD = 'correct horse battery staple';

interface Envelope {
  error: { code: string; message: string };
}
interface Me {
  email: string;
  organization: { slug: string };
  permissions: string[];
}

describe('Auth (e2e)', () => {
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
    app.use(cookieParser());
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
    // audit_events -> organizations is ON DELETE RESTRICT, so clear it first.
    await pool.query(`DELETE FROM audit_events WHERE organization_id = $1`, [
      orgId,
    ]);
    await pool.query(`DELETE FROM organizations WHERE slug = $1`, [SLUG]);
    await pool.end();
    await app.close();
  });

  it('rejects a bad password with a 401 envelope', async () => {
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

  it('logs in, returns the user + permissions, and sets an httpOnly cookie', async () => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: EMAIL, password: PASSWORD, orgSlug: SLUG });
    expect(res.status).toBe(200);
    const body = res.body as Me;
    expect(body.email).toBe(EMAIL);
    expect(body.organization.slug).toBe(SLUG);
    expect(body.permissions).toEqual(
      expect.arrayContaining(['setUsers', 'setSettings']),
    );
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain('eventa_session=');
    expect(cookie).toContain('HttpOnly');
  });

  it('rejects /auth/me without a session', async () => {
    const res = await request(server).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('supports the full login -> me -> logout lifecycle', async () => {
    const agent = request.agent(server);
    await agent
      .post('/api/v1/auth/login')
      .send({ email: EMAIL, password: PASSWORD, orgSlug: SLUG })
      .expect(200);

    const me = await agent.get('/api/v1/auth/me').expect(200);
    expect((me.body as Me).email).toBe(EMAIL);

    await agent.delete('/api/v1/session').expect(204);

    // Session revoked → the same cookie no longer authenticates.
    await agent.get('/api/v1/auth/me').expect(401);
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
