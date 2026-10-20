process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://eventa:eventa@localhost:5432/eventa';
process.env.JWT_SECRET ??= 'test-secret-at-least-16-characters-long';

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { SecretCipher } from '../src/common/crypto/secret-cipher';
import { buildValidationPipe } from '../src/common/http/validation';
import { FakeGoogleOAuthAdapter } from '../src/modules/calendar-connection/fake-google-oauth.adapter';
import { OffGoogleOAuthAdapter } from '../src/modules/calendar-connection/off-google-oauth.adapter';
import { GoogleOAuthPort } from '../src/modules/calendar-connection/ports/google-oauth.port';
import { listenOnLoopback } from './support/loopback';

const PASSWORD = 'correct horse battery staple';
const ORG = { slug: 'gcal-e2e', name: 'Calendar E2E' };
const ORG2 = { slug: 'gcal-e2e-2', name: 'Calendar E2E 2' };
const ADMIN = 'admin@gcal-e2e.test'; // every permission key
const STAFF = 'staff@gcal-e2e.test'; // regView only
const ADMIN2 = 'admin@gcal-e2e-2.test';
const ACCOUNT = 'calendar@example.test';
const CALLBACK = '/api/v1/public/calendar-connection/google/callback';

interface Success<T> {
  data: T;
  message: string;
}
interface Connection {
  provider: string;
  status: string;
  accountEmail: string | null;
  connectedAt: string | null;
}
interface ConnectionRow {
  status: string;
  account_email: string | null;
  refresh_token_cipher: Buffer | null;
  connected_by: string | null;
  oauth_state_hash: string | null;
  oauth_state_user_id: string | null;
  oauth_verifier_cipher: Buffer | null;
  oauth_state_expires_at: Date | null;
}

/** A Bangkok calendar day offset from today, as `YYYY-MM-DD`. */
const bangkokDay = (offset: number): string => {
  const ms = Date.now() + 7 * 60 * 60 * 1000 + offset * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
};

/** Boot the real AppModule with the given Google OAuth adapter. */
async function boot(oauth: GoogleOAuthPort): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GoogleOAuthPort)
    .useValue(oauth)
    .compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(buildValidationPipe());
  await listenOnLoopback(app);
  return app;
}

describe('Calendar connection (e2e — US-MTG-08)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let orgId: number;
  let otherOrgId: number;
  let adminJwt: string;
  let staffJwt: string;
  let otherJwt: string;
  let publicWebUrl: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    orgId = await seedOrg(pool, ORG, [
      { email: ADMIN, roleName: 'Admin', grants: 'all' },
      { email: STAFF, roleName: 'Staff', grants: ['regView'] },
    ]);
    otherOrgId = await seedOrg(pool, ORG2, [
      { email: ADMIN2, roleName: 'Admin', grants: 'all' },
    ]);
    app = await boot(new FakeGoogleOAuthAdapter('http://127.0.0.1/cb'));
    server = app.getHttpServer() as Server;
    publicWebUrl = app
      .get<ConfigService>(ConfigService)
      .getOrThrow<string>('PUBLIC_WEB_URL');
    adminJwt = await login(server, ADMIN, ORG.slug);
    staffJwt = await login(server, STAFF, ORG.slug);
    otherJwt = await login(server, ADMIN2, ORG2.slug);
  }, 30000);

  afterEach(async () => {
    for (const table of ['calendar_connections', 'meetings', 'outbox_events']) {
      await pool.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [
        [orgId, otherOrgId],
      ]);
    }
  });

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  const auth = (jwt: string) => ({ Authorization: `Bearer ${jwt}` });
  const status = (jwt = adminJwt) =>
    request(server).get('/api/v1/calendar-connection').set(auth(jwt));
  const post = (path: string, jwt = adminJwt) =>
    request(server).post(`/api/v1/calendar-connection/${path}`).set(auth(jwt));

  /** Start a connect; return the state the fake consent screen carries. */
  const startConnect = async (jwt = adminJwt): Promise<string> => {
    const res = await post('connect', jwt);
    expect(res.status).toBe(200);
    const { authorizeUrl } = (res.body as Success<{ authorizeUrl: string }>)
      .data;
    return new URL(authorizeUrl).searchParams.get('state') ?? '';
  };

  /** What the browser does when Google sends it back. */
  const callback = (query: Record<string, string>) => {
    const { port } = server.address() as AddressInfo;
    const qs = new URLSearchParams(query).toString();
    return fetch(`http://127.0.0.1:${port}${CALLBACK}?${qs}`, {
      redirect: 'manual',
    });
  };

  const landing = (outcome: string) =>
    `${publicWebUrl}/admin/settings-integrations?calendar=${outcome}`;

  const connectionRow = async (org = orgId) => {
    const { rows } = await pool.query<ConnectionRow>(
      `SELECT * FROM calendar_connections WHERE organization_id = $1`,
      [org],
    );
    return rows[0] ?? null;
  };

  const connect = async (): Promise<void> => {
    const state = await startConnect();
    const res = await callback({ code: 'fake-auth-code', state });
    expect(res.headers.get('location')).toBe(landing('connected'));
  };

  it('starts disconnected', async () => {
    const res = await status();
    expect(res.status).toBe(200);
    expect((res.body as Success<Connection>).data).toEqual({
      provider: 'google',
      status: 'disconnected',
      accountEmail: null,
      connectedAt: null,
    });
  });

  it('Admin connects: 302 to /admin/settings-integrations?calendar=connected; status connected as calendar@example.test', async () => {
    const state = await startConnect();
    const res = await callback({ code: 'fake-auth-code', state });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(landing('connected'));

    const after = (await status()).body as Success<Connection>;
    expect(after.data).toMatchObject({
      status: 'connected',
      accountEmail: ACCOUNT,
    });
    expect(after.data.connectedAt).not.toBeNull();
    const row = await connectionRow();
    expect(row?.oauth_state_hash).toBeNull();
    expect(row?.oauth_state_user_id).toBeNull();
    expect(row?.oauth_verifier_cipher).toBeNull();
    expect(row?.oauth_state_expires_at).toBeNull();
    expect(row?.connected_by).not.toBeNull();
  });

  it('stored refresh token is ciphertext and decrypts with SecretCipher', async () => {
    await connect();
    const row = await connectionRow();
    const cipherBytes = row?.refresh_token_cipher;
    expect(cipherBytes).toBeInstanceOf(Buffer);
    expect(cipherBytes?.toString('latin1')).not.toContain('fake-refresh');
    const cipher = new SecretCipher(app.get(ConfigService));
    expect(cipher.decrypt(cipherBytes as Buffer)).toMatch(
      /^fake-refresh-[0-9a-f-]{36}$/,
    );
  });

  it('stores only the hash of the pending nonce, and an encrypted verifier', async () => {
    const state = await startConnect();
    const nonce = state.split('.')[1];
    const row = await connectionRow();
    expect(row?.status).toBe('disconnected');
    expect(row?.oauth_state_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.oauth_state_hash).not.toBe(nonce);
    expect(row?.oauth_verifier_cipher).toBeInstanceOf(Buffer);
    expect(row?.oauth_state_expires_at?.getTime()).toBeGreaterThan(Date.now());
    expect(state).toMatch(new RegExp(`^${orgId}\\.[A-Za-z0-9_-]{43}$`));
  });

  it('connecting re-sends meetings saved while disconnected (outbox gains meeting.sync_requested; row pending)', async () => {
    const scheduled = await request(server)
      .post('/api/v1/meetings')
      .set(auth(adminJwt))
      .send({
        title: 'Sponsor sync',
        date: bangkokDay(3),
        startTime: '09:00',
        endTime: '10:00',
        type: 'Sponsor',
        mode: 'Video',
        person: 'Khun Malee',
        guestEmail: 'malee@sponsor.co.th',
      });
    expect(scheduled.status).toBe(201);
    const meetingId = (scheduled.body as Success<{ id: string }>).data.id;
    // What the worker writes when no calendar is connected.
    await pool.query(
      `UPDATE meetings SET sync_status = 'not_connected' WHERE id = $1`,
      [meetingId],
    );
    await pool.query(`DELETE FROM outbox_events WHERE aggregate_id = $1`, [
      meetingId,
    ]);

    await connect();

    const { rows: events } = await pool.query<{
      routing_key: string;
      payload: { intent: string; needsLink: boolean };
    }>(
      `SELECT routing_key, payload FROM outbox_events WHERE aggregate_id = $1`,
      [meetingId],
    );
    expect(events).toHaveLength(1);
    expect(events[0].routing_key).toBe('meeting.sync_requested');
    expect(events[0].payload).toMatchObject({
      intent: 'create',
      needsLink: true,
    });
    const { rows } = await pool.query<{ sync_status: string }>(
      `SELECT sync_status FROM meetings WHERE id = $1`,
      [meetingId],
    );
    expect(rows[0].sync_status).toBe('pending');
  });

  it('state is single-use: replay gives calendar=failed', async () => {
    const state = await startConnect();
    await callback({ code: 'fake-auth-code', state });
    const replay = await callback({ code: 'fake-auth-code', state });
    expect(replay.headers.get('location')).toBe(landing('failed'));
  });

  it('a wrong nonce gives failed and the real callback still connects afterwards', async () => {
    const state = await startConnect();
    const forged = `${orgId}.${'A'.repeat(43)}`;
    const wrong = await callback({ code: 'fake-auth-code', state: forged });
    expect(wrong.headers.get('location')).toBe(landing('failed'));
    expect((await connectionRow())?.oauth_state_hash).not.toBeNull();

    const real = await callback({ code: 'fake-auth-code', state });
    expect(real.headers.get('location')).toBe(landing('connected'));
  });

  it('a state naming another workspace gives failed; neither workspace changes', async () => {
    const state = await startConnect();
    const before = await connectionRow();
    const nonce = state.split('.')[1];
    const res = await callback({
      code: 'fake-auth-code',
      state: `${otherOrgId}.${nonce}`,
    });
    expect(res.headers.get('location')).toBe(landing('failed'));
    expect(await connectionRow(otherOrgId)).toBeNull();
    expect(await connectionRow()).toEqual(before);
  });

  it('error=access_denied gives denied', async () => {
    const state = await startConnect();
    const res = await callback({ error: 'access_denied', state });
    expect(res.headers.get('location')).toBe(landing('denied'));
    expect((await connectionRow())?.status).toBe('disconnected');
  });

  it('a malformed or repeated parameter still redirects, never a JSON 400', async () => {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(
      `http://127.0.0.1:${port}${CALLBACK}?state=a&state=b&code=x&code=y`,
      { redirect: 'manual' },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(landing('failed'));
    const bare = await fetch(`http://127.0.0.1:${port}${CALLBACK}`, {
      redirect: 'manual',
    });
    expect(bare.headers.get('location')).toBe(landing('failed'));
  });

  it('Staff: GET 200 with accountEmail null; connect 403; disconnect 403', async () => {
    await connect();
    const res = await status(staffJwt);
    expect(res.status).toBe(200);
    expect((res.body as Success<Connection>).data).toMatchObject({
      status: 'connected',
      accountEmail: null,
    });
    expect((await post('connect', staffJwt)).status).toBe(403);
    expect((await post('disconnect', staffJwt)).status).toBe(403);
    expect((await connectionRow())?.status).toBe('connected');
  });

  it('refuses an anonymous caller', async () => {
    expect(
      (await request(server).get('/api/v1/calendar-connection')).status,
    ).toBe(401);
  });

  it('disconnect clears token, account and pending state', async () => {
    await connect();
    await startConnect(); // a reconnect in progress, abandoned
    const res = await post('disconnect');
    expect(res.status).toBe(200);
    expect((res.body as Success<Connection>).message).toBe(
      'Google Calendar disconnected.',
    );
    expect((res.body as Success<Connection>).data).toEqual({
      provider: 'google',
      status: 'disconnected',
      accountEmail: null,
      connectedAt: null,
    });
    const row = await connectionRow();
    expect(row).toMatchObject({
      status: 'disconnected',
      refresh_token_cipher: null,
      account_email: null,
      oauth_state_hash: null,
      oauth_state_user_id: null,
      oauth_verifier_cipher: null,
      oauth_state_expires_at: null,
    });
  });

  it('disconnect is idempotent and creates no row for a workspace that never connected', async () => {
    expect((await post('disconnect')).status).toBe(200);
    expect((await post('disconnect')).status).toBe(200);
    expect(await connectionRow()).toBeNull();
  });

  it('another workspace sees disconnected', async () => {
    await connect();
    const res = await status(otherJwt);
    expect((res.body as Success<Connection>).data.status).toBe('disconnected');
  });

  it('Location header is exactly the fixed URL; Cache-Control no-store', async () => {
    const state = await startConnect();
    const res = await callback({ code: 'fake-auth-code', state });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(landing('connected'));
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  describe('not configured (Off adapter override)', () => {
    let offApp: INestApplication;
    let offServer: Server;

    beforeAll(async () => {
      offApp = await boot(new OffGoogleOAuthAdapter());
      offServer = offApp.getHttpServer() as Server;
    }, 30000);

    afterAll(async () => {
      await offApp.close();
    });

    it('GET not_configured; connect 409 with the sentence', async () => {
      const got = await request(offServer)
        .get('/api/v1/calendar-connection')
        .set(auth(adminJwt));
      expect(got.status).toBe(200);
      expect((got.body as Success<Connection>).data.status).toBe(
        'not_configured',
      );
      const res = await request(offServer)
        .post('/api/v1/calendar-connection/connect')
        .set(auth(adminJwt));
      expect(res.status).toBe(409);
      expect((res.body as { message: string }).message).toBe(
        "Google Calendar isn't set up on this server yet.",
      );
    });
  });
});

async function login(
  server: Server,
  email: string,
  orgSlug: string,
): Promise<string> {
  const res = await request(server)
    .post('/api/v1/auth/login')
    .send({ email, password: PASSWORD, orgSlug, persona: 'admin' });
  return (res.body as Success<{ accessToken: string }>).data.accessToken;
}

async function seedOrg(
  pool: Pool,
  org: { slug: string; name: string },
  people: { email: string; roleName: string; grants: string[] | 'all' }[],
): Promise<number> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
    [org.name, org.slug],
  );
  const id = Number(res.rows[0].id);
  const passwordHash = await hash(PASSWORD);
  for (const p of people) {
    // `is_system` false on purpose: a role marked built-in is reconciled
    // against DEFAULT_ROLES, which would top Staff's narrow grant back up.
    const role = await pool.query<{ id: string }>(
      `INSERT INTO roles (organization_id, name, description, is_system)
       VALUES ($1, $2, 'seed', false) RETURNING id`,
      [id, p.roleName],
    );
    const roleId = Number(role.rows[0].id);
    // The catalogue the migrations seed: "all" is every key it holds.
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_key, granted)
       SELECT $1, key, true FROM permissions
        WHERE $2::text[] IS NULL OR key::text = ANY($2::text[])`,
      [roleId, p.grants === 'all' ? null : p.grants],
    );
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

async function cleanup(pool: Pool): Promise<void> {
  const slugs = [ORG.slug, ORG2.slug];
  // audit_events is ON DELETE RESTRICT (a sign-in writes one), so it is
  // cleared before the organizations delete; the rest cascade.
  for (const table of ['meetings', 'outbox_events', 'audit_events']) {
    await pool.query(
      `DELETE FROM ${table} WHERE organization_id IN
         (SELECT id FROM organizations WHERE slug = ANY($1))`,
      [slugs],
    );
  }
  await pool.query(`DELETE FROM organizations WHERE slug = ANY($1)`, [slugs]);
}
