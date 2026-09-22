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

/**
 * Sending a broadcast, and being able to say afterwards that you did
 * (US-MSG-04 / US-EVT-14), against a real database.
 *
 * The unit tests prove the service hands the right things to the repository.
 * What only this can prove is the pair that matters: ONE request writes both
 * the announcement row and the outbox event that actually sends it. An
 * announcement listed but never sent is a lie to the organizer; one sent but
 * never listed is a broadcast to hundreds of people with no trace of who did
 * it. Either on its own is worse than neither.
 */

const PASSWORD = 'correct horse battery staple';
const ORG = { slug: 'ann-e2e', name: 'Announcements E2E' };
const ORG2 = { slug: 'ann-e2e-2', name: 'Announcements E2E 2' };
const ADMIN = 'admin@ann-e2e.test';
const OUTSIDER = 'nobody@ann-e2e.test';
const ADMIN2 = 'admin@ann-e2e-2.test';

const PERM_GROUP: Record<string, string> = {
  regView: 'Registrations',
  evCreate: 'Events',
};

interface Success<T> {
  data: T;
  meta?: { total: number };
}
interface Announcement {
  id: string;
  eventId: string;
  eventName: string | null;
  subject: string;
  body: string;
  recipientCount: number;
  sentAt: string;
}

describe('Announcements (e2e — US-MSG-04)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let orgId: number;
  let otherOrgId: number;
  let summitId: string;
  let jazzId: string;
  let otherEventId: string;
  let adminJwt: string;
  let outsiderJwt: string;
  let otherJwt: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    orgId = await seedOrg(pool, ORG, [
      { email: ADMIN, roleName: 'Admin', grants: ['regView', 'evCreate'] },
      { email: OUTSIDER, roleName: 'Marketing', grants: ['evCreate'] },
    ]);
    otherOrgId = await seedOrg(pool, ORG2, [
      { email: ADMIN2, roleName: 'Admin', grants: ['regView', 'evCreate'] },
    ]);
    summitId = await seedEvent(pool, orgId, 'ann-summit', 'Tech Summit 2026');
    jazzId = await seedEvent(pool, orgId, 'ann-jazz', 'Bangkok Jazz Night');
    otherEventId = await seedEvent(pool, otherOrgId, 'ann-other', 'Other Org');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await listenOnLoopback(app);
    server = app.getHttpServer() as Server;

    adminJwt = await token(ADMIN, ORG.slug);
    outsiderJwt = await token(OUTSIDER, ORG.slug);
    otherJwt = await token(ADMIN2, ORG2.slug);
  }, 30000);

  afterEach(async () => {
    for (const table of ['announcements', 'outbox_events']) {
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

  async function token(email: string, orgSlug: string): Promise<string> {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, orgSlug, persona: 'admin' });
    return (res.body as Success<{ accessToken: string }>).data.accessToken;
  }

  const send = (jwt: string, eventId: string, body: object) =>
    request(server)
      .post(`/api/v1/events/${eventId}/attendees/email`)
      .set('Authorization', `Bearer ${jwt}`)
      .send(body);

  const list = (jwt: string, query = '') =>
    request(server)
      .get(`/api/v1/announcements${query}`)
      .set('Authorization', `Bearer ${jwt}`);

  const broadcast = {
    subject: 'Venue change',
    message: 'Hall B',
    confirm: true,
  };

  const items = (body: unknown) => (body as Success<Announcement[]>).data;

  describe('sending one', () => {
    it('writes the record and the send together', async () => {
      await send(adminJwt, summitId, broadcast).expect(201);

      const rows = await pool.query(
        `SELECT subject FROM announcements WHERE organization_id = $1`,
        [orgId],
      );
      const queued = await pool.query(
        `SELECT routing_key FROM outbox_events
         WHERE organization_id = $1 AND routing_key = 'events.attendees_email_requested'`,
        [orgId],
      );
      expect(rows.rowCount).toBe(1);
      expect(queued.rowCount).toBe(1);
    });

    it('writes NEITHER when the event is not the caller’s', async () => {
      // The 404 has to leave the outbox alone as well as the table: a queued
      // send would reach another workspace's attendees.
      await send(adminJwt, otherEventId, broadcast).expect(404);

      const rows = await pool.query(
        `SELECT 1 FROM announcements WHERE organization_id = ANY($1)`,
        [[orgId, otherOrgId]],
      );
      const queued = await pool.query(
        `SELECT 1 FROM outbox_events
         WHERE routing_key = 'events.attendees_email_requested'
           AND organization_id = ANY($1)`,
        [[orgId, otherOrgId]],
      );
      expect(rows.rowCount).toBe(0);
      expect(queued.rowCount).toBe(0);
    });

    it('writes nothing when the body is refused', async () => {
      await send(adminJwt, summitId, { ...broadcast, confirm: false }).expect(
        400,
      );
      const rows = await pool.query(
        `SELECT 1 FROM announcements WHERE organization_id = $1`,
        [orgId],
      );
      expect(rows.rowCount).toBe(0);
    });
  });

  describe('the history', () => {
    it('answers with what was sent, and to how many', async () => {
      await send(adminJwt, summitId, broadcast).expect(201);

      const res = await list(adminJwt).expect(200);
      expect(items(res.body)).toHaveLength(1);
      expect(items(res.body)[0]).toMatchObject({
        eventId: summitId,
        eventName: 'Tech Summit 2026',
        subject: 'Venue change',
        body: 'Hall B',
        recipientCount: 0,
      });
    });

    it('puts the most recent first', async () => {
      await send(adminJwt, summitId, broadcast).expect(201);
      await send(adminJwt, jazzId, { ...broadcast, subject: 'Later' }).expect(
        201,
      );

      const res = await list(adminJwt).expect(200);
      expect(items(res.body).map((a) => a.subject)).toEqual([
        'Later',
        'Venue change',
      ]);
    });

    it('narrows to one event', async () => {
      await send(adminJwt, summitId, broadcast).expect(201);
      await send(adminJwt, jazzId, { ...broadcast, subject: 'Jazz' }).expect(
        201,
      );

      const res = await list(adminJwt, `?eventId=${jazzId}`).expect(200);
      expect(items(res.body).map((a) => a.subject)).toEqual(['Jazz']);
    });

    it('keeps the record when the event it was about is deleted', async () => {
      // The message really did reach people. Losing the record with the event
      // would erase that.
      await send(adminJwt, jazzId, { ...broadcast, subject: 'Gone' }).expect(
        201,
      );
      await pool.query(`DELETE FROM events WHERE id = $1`, [jazzId]);

      const res = await list(adminJwt).expect(200);
      expect(items(res.body)[0]).toMatchObject({
        subject: 'Gone',
        eventName: null,
      });

      jazzId = await seedEvent(pool, orgId, 'ann-jazz', 'Bangkok Jazz Night');
    });

    it('never shows another workspace’s broadcasts', async () => {
      await send(adminJwt, summitId, broadcast).expect(201);
      const theirs = await list(otherJwt).expect(200);
      expect(items(theirs.body)).toHaveLength(0);
    });

    it('refuses a member without the attendee-data permission', async () => {
      await list(outsiderJwt).expect(403);
    });
  });
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
  const orgId = Number(res.rows[0].id);
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
      [orgId, p.roleName],
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
       VALUES ($1, 'Anan Suksawat', $2, 'admin', 'Active', $3) RETURNING id`,
      [orgId, p.email, passwordHash],
    );
    await pool.query(
      `INSERT INTO memberships (organization_id, user_id, role_id, role, status)
       VALUES ($1, $2, $3, $4, 'Active')`,
      [orgId, user.rows[0].id, roleId, p.roleName],
    );
  }
  return orgId;
}

async function seedEvent(
  pool: Pool,
  orgId: number,
  slug: string,
  name: string,
): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO events (organization_id, slug, name, type, bucket, status, visibility,
                         start_at, end_at, timezone, organizer_name, venue_name, city, published_at)
     VALUES ($1,$2,$3,'Conference','active','live','public',
             now() + interval '10 days', now() + interval '10 days' + interval '8 hours',
             'Asia/Bangkok','Acme','QSNCC','Bangkok', now())
     RETURNING id`,
    [orgId, slug, name],
  );
  return res.rows[0].id;
}

async function cleanup(pool: Pool): Promise<void> {
  const slugs = [ORG.slug, ORG2.slug];
  for (const table of [
    'audit_events',
    'outbox_events',
    'announcements',
    'orders',
    'events',
  ]) {
    await pool.query(
      `DELETE FROM ${table} WHERE organization_id IN
         (SELECT id FROM organizations WHERE slug = ANY($1))`,
      [slugs],
    );
  }
  await pool.query(`DELETE FROM organizations WHERE slug = ANY($1)`, [slugs]);
}
