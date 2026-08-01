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

const PASSWORD = 'correct horse battery staple';
const ORG = { slug: 'pay-e2e', name: 'Pay E2E' };
const ADMIN = 'admin@pay-e2e.test'; // setSettings + setIntegrations
const STAFF = 'staff@pay-e2e.test'; // neither

const PERM_GROUP: Record<string, string> = {
  setSettings: 'Settings',
  setIntegrations: 'Settings',
  regView: 'Registrations',
};

interface Success<T> {
  data: T;
}
interface Settings {
  status: string;
  mode: string;
  testMode: boolean;
  accountId: string | null;
  publishableKey: string | null;
  defaultCurrency: string;
  statementDescriptor: string | null;
  emailReceipts: boolean;
  warnings?: string[];
}
interface MethodView {
  method: string;
  enabled: boolean;
}

describe('Payment settings (e2e — US-SET-08/09/10)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let orgId: number;
  let adminJwt: string;
  let staffJwt: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    orgId = await seedOrg(pool, ORG, [
      {
        email: ADMIN,
        roleName: 'Admin',
        grants: ['setSettings', 'setIntegrations'],
      },
      { email: STAFF, roleName: 'Staff', grants: ['regView'] },
    ]);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();
    server = app.getHttpServer() as Server;

    adminJwt = await login(ADMIN);
    staffJwt = await login(STAFF);
  }, 30000);

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  const login = async (email: string): Promise<string> => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, orgSlug: ORG.slug });
    return (res.body as Success<{ accessToken: string }>).data.accessToken;
  };

  const auth = (jwt: string) => ({ Authorization: `Bearer ${jwt}` });
  const get = () =>
    request(server).get('/api/v1/payment-settings').set(auth(adminJwt));
  const post = (path: string, body: object = {}) =>
    request(server)
      .post(`/api/v1/payment-settings/${path}`)
      .set(auth(adminJwt))
      .send(body);
  const setMethod = (method: string, enabled: boolean) =>
    request(server)
      .patch(`/api/v1/payment-settings/methods/${encodeURIComponent(method)}`)
      .set(auth(adminJwt))
      .send({ enabled });

  it('starts disconnected in test mode, with the no-real-charges flag on', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const s = (res.body as Success<Settings>).data;
    expect(s).toMatchObject({
      status: 'disconnected',
      mode: 'test',
      testMode: true,
    });
  });

  it('SET-08: refuses an account the provider cannot verify (422)', async () => {
    const res = await post('connect', {
      accountId: 'acct_bad!',
      publishableKey: 'pk_test_x',
      mode: 'test',
    });
    expect([400, 422]).toContain(res.status);
    expect((await get()).body).toMatchObject({
      data: { status: 'disconnected' },
    });
  });

  it('SET-08: connects a valid account and stores no secret', async () => {
    const res = await post('connect', {
      accountId: 'acct_1A2b3C',
      publishableKey: 'pk_test_51A2b3C',
      mode: 'test',
    });
    expect(res.status).toBe(200);
    const s = (res.body as Success<Settings>).data;
    expect(s).toMatchObject({ status: 'connected', accountId: 'acct_1A2b3C' });
    expect(JSON.stringify(res.body)).not.toMatch(/sk_live|sk_test|secretKey/);
  });

  it('SET-08: tests the connection without moving money', async () => {
    const res = await post('test');
    expect(res.status).toBe(200);
    expect((res.body as Success<{ ok: boolean }>).data.ok).toBe(true);
  });

  it('SET-09: lists every method, all disabled until turned on', async () => {
    const res = await request(server)
      .get('/api/v1/payment-settings/methods')
      .set(auth(adminJwt));
    expect(res.status).toBe(200);
    const methods = (res.body as Success<MethodView[]>).data;
    expect(methods).toHaveLength(5);
    expect(methods.every((m) => !m.enabled)).toBe(true);
  });

  it('SET-09: enables PromptPay, then blocks turning off the last one while paid tickets exist', async () => {
    expect((await setMethod('PromptPay', true)).status).toBe(200);
    // no paid ticket types yet → turning it off is allowed
    expect((await setMethod('PromptPay', false)).status).toBe(200);

    await pool.query(
      `INSERT INTO events (organization_id, slug, name, type, bucket, start_at, organizer_name)
       VALUES ($1, 'pay-evt', 'Pay Evt', 'Conference', 'active', now(), 'Org')`,
      [orgId],
    );
    const evt = await pool.query<{ id: string }>(
      `SELECT id FROM events WHERE organization_id = $1 LIMIT 1`,
      [orgId],
    );
    await pool.query(
      `INSERT INTO ticket_types (organization_id, event_id, name, price_satang, is_free)
       VALUES ($1, $2, 'GA', 50000, false)`,
      [orgId, evt.rows[0].id],
    );

    await setMethod('PromptPay', true);
    const blocked = await setMethod('PromptPay', false);
    expect(blocked.status).toBe(422);
    expect((blocked.body as { message: string }).message).toMatch(
      /at least one payment method/i,
    );
  });

  it('SET-09: a wallet stays off until a payment account is connected', async () => {
    await post('disconnect');
    const res = await setMethod('Apple Pay', true);
    expect(res.status).toBe(422);
    expect((res.body as { message: string }).message).toMatch(
      /connect a payment account/i,
    );
  });

  it('SET-10: saves a statement descriptor and warns on a differing currency', async () => {
    const ok = await request(server)
      .patch('/api/v1/payment-settings')
      .set(auth(adminJwt))
      .send({ statementDescriptor: 'PAY E2E', emailReceipts: true });
    expect(ok.status).toBe(200);
    expect((ok.body as Success<Settings>).data.statementDescriptor).toBe(
      'PAY E2E',
    );

    const warned = await request(server)
      .patch('/api/v1/payment-settings')
      .set(auth(adminJwt))
      .send({ defaultCurrency: 'USD' });
    expect(warned.status).toBe(200);
    const s = (warned.body as Success<Settings>).data;
    expect(s.defaultCurrency).toBe('USD'); // warned, not blocked
    expect(s.warnings?.join(' ')).toMatch(/differs from the organization/i);
  });

  it('SET-10: rejects a descriptor longer than 22 characters (400)', async () => {
    const res = await request(server)
      .patch('/api/v1/payment-settings')
      .set(auth(adminJwt))
      .send({ statementDescriptor: 'A'.repeat(23) });
    expect(res.status).toBe(400);
  });

  it('forbids a member without the settings permissions (403)', async () => {
    expect(
      (
        await request(server)
          .get('/api/v1/payment-settings')
          .set(auth(staffJwt))
      ).status,
    ).toBe(403);
    expect(
      (
        await request(server)
          .post('/api/v1/payment-settings/disconnect')
          .set(auth(staffJwt))
      ).status,
    ).toBe(403);
  });

  async function seedOrg(
    pool: Pool,
    org: { slug: string; name: string },
    people: { email: string; roleName: string; grants: string[] }[],
  ): Promise<number> {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
      [org.name, org.slug],
    );
    const id = Number(res.rows[0].id);
    const passwordHash = await hash(PASSWORD);
    for (const p of people) {
      for (const key of p.grants) {
        await pool.query(
          `INSERT INTO permissions (key, "group", label) VALUES ($1, $2, $3)
           ON CONFLICT (key) DO NOTHING`,
          [key, PERM_GROUP[key], key],
        );
      }
      const role = await pool.query<{ id: string }>(
        `INSERT INTO roles (organization_id, name, description) VALUES ($1, $2, 'seed') RETURNING id`,
        [id, p.roleName],
      );
      const roleId = Number(role.rows[0].id);
      for (const key of p.grants) {
        await pool.query(
          `INSERT INTO role_permissions (role_id, permission_key, granted) VALUES ($1, $2, true)`,
          [roleId, key],
        );
      }
      const user = await pool.query<{ id: string }>(
        `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
         VALUES ($1, 'Seed', $2, 'admin', 'Active', $3) RETURNING id`,
        [id, p.email, passwordHash],
      );
      await pool.query(
        `INSERT INTO memberships (organization_id, user_id, role_id, role, status)
         VALUES ($1, $2, $3, $4, 'Active')`,
        [id, user.rows[0].id, roleId, p.roleName],
      );
    }
    return id;
  }
});

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM audit_events WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug = $1)`,
    [ORG.slug],
  );
  await pool.query(`DELETE FROM organizations WHERE slug = $1`, [ORG.slug]);
}
