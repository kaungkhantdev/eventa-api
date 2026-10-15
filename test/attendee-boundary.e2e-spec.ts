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
import { listenOnLoopback } from './support/loopback';

const PASSWORD = 'correct horse battery staple';
const ORG = { slug: 'boundary-e2e', name: 'Boundary E2E' };
/** One address, two accounts: an organizer here and an attendee on the platform. */
const BOTH = 'both@boundary-e2e.test';
const EVENT_SLUG = 'boundary-public';
const SOME_ID = '00000000-0000-4000-8000-0000000000aa';

interface Success<T> {
  data: T;
}

/**
 * NFR-SEC-01 / US-ACC-11: "The two account types share no login or session;
 * access across the boundary is impossible and verified by test."
 *
 * The attendee's own realm — tickets, payments, saved events — is reached at
 * `/me/...` and keyed on the caller's account. An organizer's token is a valid
 * token too, so without a persona check it read the attendee realm for its
 * email and wrote saved events; only the web's route guards stood in the way.
 * The address is shared on purpose: that is the case the boundary exists for.
 */
describe('Attendee realm is closed to organizer tokens (e2e — US-ACC-11)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let eventId: string;
  let organizer: string;
  let attendee: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    eventId = await seed(pool);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await listenOnLoopback(app);
    server = app.getHttpServer() as Server;

    organizer = await signIn({ persona: 'admin', orgSlug: ORG.slug });
    attendee = await signIn({ persona: 'attendee' });
  }, 30000);

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  async function signIn(extra: Record<string, string>): Promise<string> {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: BOTH, password: PASSWORD, ...extra });
    expect(res.status).toBe(200);
    return (res.body as Success<{ accessToken: string }>).data.accessToken;
  }

  const call =
    (method: 'get' | 'put' | 'delete' | 'post', path: string) =>
    (jwt: string) =>
      request(server)
        [method](`/api/v1${path}`)
        .set('Authorization', `Bearer ${jwt}`)
        .send(method === 'post' ? { eventIds: [eventId] } : undefined);

  const savedRows = async (): Promise<number> => {
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int n FROM saved_events s
         JOIN users u ON u.id = s.user_id
        WHERE u.email = $1`,
      [BOTH],
    );
    return rows[0].n;
  };

  const routes = (): [string, (jwt: string) => request.Test][] => [
    ['GET /me/tickets', call('get', '/me/tickets')],
    ['GET /me/tickets/:id', call('get', `/me/tickets/${SOME_ID}`)],
    [
      'GET /me/tickets/:id/pass.svg',
      call('get', `/me/tickets/${SOME_ID}/pass.svg`),
    ],
    ['GET /me/payments', call('get', '/me/payments')],
    ['GET /me/payments/summary', call('get', '/me/payments/summary')],
    ['GET /me/payments/export.csv', call('get', '/me/payments/export.csv')],
    [
      'GET /me/payments/:id/receipt.svg',
      call('get', `/me/payments/${SOME_ID}/receipt.svg`),
    ],
    ['GET /me/saved-events', call('get', '/me/saved-events')],
    ['PUT /me/saved-events/:id', call('put', `/me/saved-events/${eventId}`)],
    [
      'DELETE /me/saved-events/:id',
      call('delete', `/me/saved-events/${eventId}`),
    ],
    ['POST /me/saved-events/merge', call('post', '/me/saved-events/merge')],
  ];

  it('refuses an organizer token on every attendee route (403)', async () => {
    for (const [name, send] of routes()) {
      const res = await send(organizer);
      expect({ route: name, status: res.status }).toEqual({
        route: name,
        status: 403,
      });
    }
    // …and nothing was written on its behalf.
    expect(await savedRows()).toBe(0);
  });

  it('still serves the attendee with the same email', async () => {
    expect((await call('get', '/me/tickets')(attendee)).status).toBe(200);
    expect((await call('get', '/me/payments')(attendee)).status).toBe(200);
    expect((await call('get', '/me/saved-events')(attendee)).status).toBe(200);
    expect(
      (await call('put', `/me/saved-events/${eventId}`)(attendee)).status,
    ).toBe(204);
    expect(await savedRows()).toBe(1);
  });
});

async function seed(pool: Pool): Promise<string> {
  const org = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1,$2) RETURNING id`,
    [ORG.name, ORG.slug],
  );
  const orgId = Number(org.rows[0].id);
  const passwordHash = await hash(PASSWORD);
  await pool.query(
    `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
     VALUES ($1,'Organizer',$2,'admin','Active',$3)`,
    [orgId, BOTH, passwordHash],
  );
  // Attendee accounts live in the platform org, whatever workspace runs the event.
  await pool.query(
    `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
     SELECT id, 'Attendee', $1, 'attendee', 'Active', $2
       FROM organizations WHERE slug = 'eventa'`,
    [BOTH, passwordHash],
  );
  // A published event, so a save the guard did not stop would succeed.
  const event = await pool.query<{ id: string }>(
    `INSERT INTO events (organization_id, slug, name, type, bucket, status, visibility,
                         start_at, timezone, organizer_name, published_at)
     VALUES ($1,$2,'Boundary','Conference','active','upcoming','public',
             now() + interval '30 days','Asia/Bangkok','Acme',now())
     RETURNING id`,
    [orgId, EVENT_SLUG],
  );
  return event.rows[0].id;
}

async function cleanup(pool: Pool): Promise<void> {
  // The platform org is shared and permanent — remove only OUR users from it.
  await pool.query(
    `DELETE FROM saved_events WHERE user_id IN
       (SELECT id FROM users WHERE email = $1)`,
    [BOTH],
  );
  await pool.query(
    `DELETE FROM outbox_events WHERE aggregate_id IN
       (SELECT id::text FROM users WHERE email = $1)`,
    [BOTH],
  );
  // audit_events is ON DELETE RESTRICT (a sign-in writes one), so clear it first.
  await pool.query(
    `DELETE FROM audit_events WHERE actor_user_id IN
       (SELECT id FROM users WHERE email = $1)`,
    [BOTH],
  );
  await pool.query(
    `DELETE FROM audit_events WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug = $1)`,
    [ORG.slug],
  );
  await pool.query(`DELETE FROM users WHERE email = $1`, [BOTH]);
  await pool.query(`DELETE FROM organizations WHERE slug = $1`, [ORG.slug]);
}
