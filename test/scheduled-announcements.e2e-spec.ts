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
import {
  ALREADY_CANCELLED,
  ALREADY_SENT,
} from '../src/modules/announcements/announcement-schedule';
import { listenOnLoopback } from './support/loopback';

/**
 * Scheduling an announcement, and changing your mind before it goes
 * (US-MSG-04/05, TC-MSG-10..12), against a real database.
 *
 * The unit tests prove the rules. What only this can prove is what the rows
 * say: a scheduled announcement is written with NO outbox event (one would
 * email everybody now), a cancelled one stays in the history and never gets
 * one, and a change that meets an announcement the worker has already claimed
 * is refused — even when it was waiting on the worker's lock at the time.
 */

const PASSWORD = 'correct horse battery staple';
const ORG = { slug: 'sched-ann-e2e', name: 'Scheduled Announcements E2E' };
const ORG2 = { slug: 'sched-ann-e2e-2', name: 'Scheduled Announcements E2E 2' };
const ADMIN = 'admin@sched-ann-e2e.test';
const OUTSIDER = 'nobody@sched-ann-e2e.test';
const ADMIN2 = 'admin@sched-ann-e2e-2.test';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const ATTENDEES_EMAIL = 'events.attendees_email_requested';

const PERM_GROUP: Record<string, string> = {
  regView: 'Registrations',
  evCreate: 'Events',
};

interface Success<T> {
  data: T;
  message?: string;
}
interface Failure {
  message: string;
  errors?: { field: string; message: string }[];
}
interface Announcement {
  id: string;
  subject: string;
  status: 'scheduled' | 'sent' | 'cancelled';
  scheduledFor: string | null;
  sentAt: string | null;
  cancelledAt: string | null;
  recipientCount: number | null;
}
interface Broadcast {
  eventId: string;
  recipients: number;
  queued: boolean;
  scheduledFor: string | null;
}
interface Row {
  status: string;
  scheduled_for: Date | null;
  sent_at: Date | null;
  recipient_count: string | null;
  cancelled_at: Date | null;
  cancelled_by_user_id: string | null;
}

const ahead = (ms: number) => new Date(Date.now() + ms).toISOString();

describe('Scheduled announcements (e2e — US-MSG-04/05)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let orgId: number;
  let otherOrgId: number;
  let summitId: string;
  let adminId: string;
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
    summitId = await seedEvent(pool, orgId, 'sched-summit', 'Tech Summit 2026');
    const admin = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1`,
      [ADMIN],
    );
    adminId = admin.rows[0].id;

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

  const broadcast = {
    subject: 'Venue change',
    message: 'Hall B',
    confirm: true,
  };

  const send = (jwt: string, body: object) =>
    request(server)
      .post(`/api/v1/events/${summitId}/attendees/email`)
      .set('Authorization', `Bearer ${jwt}`)
      .send(body);

  const list = (jwt: string) =>
    request(server)
      .get('/api/v1/announcements')
      .set('Authorization', `Bearer ${jwt}`);

  const cancel = (jwt: string, id: string) =>
    request(server)
      .post(`/api/v1/announcements/${id}/cancel`)
      .set('Authorization', `Bearer ${jwt}`);

  const reschedule = (jwt: string, id: string, sendAt: string) =>
    request(server)
      .patch(`/api/v1/announcements/${id}`)
      .set('Authorization', `Bearer ${jwt}`)
      .send({ sendAt });

  /** Schedule one for the summit and answer with its id. */
  async function scheduled(sendAt = ahead(DAY)): Promise<string> {
    await send(adminJwt, { ...broadcast, sendAt }).expect(201);
    const res = await pool.query<{ id: string }>(
      `SELECT id FROM announcements WHERE organization_id = $1
       ORDER BY id DESC LIMIT 1`,
      [orgId],
    );
    return String(res.rows[0].id);
  }

  async function row(id: string): Promise<Row> {
    const res = await pool.query<Row>(
      `SELECT status, scheduled_for, sent_at, recipient_count, cancelled_at,
              cancelled_by_user_id
       FROM announcements WHERE id = $1`,
      [id],
    );
    return res.rows[0];
  }

  async function queuedSends(): Promise<number> {
    const res = await pool.query(
      `SELECT 1 FROM outbox_events
       WHERE organization_id = ANY($1) AND routing_key = $2`,
      [[orgId, otherOrgId], ATTENDEES_EMAIL],
    );
    return res.rowCount ?? 0;
  }

  /** What the sweep in eventa-worker does when it claims one. */
  async function sweepSends(id: string): Promise<void> {
    await pool.query(
      `UPDATE announcements
       SET status = 'sent', sent_at = now(), recipient_count = 0
       WHERE id = $1`,
      [id],
    );
  }

  const items = (body: unknown) => (body as Success<Announcement[]>).data;
  const failure = (body: unknown) => body as Failure;

  describe('scheduling one (TC-MSG-10a)', () => {
    it('records it as scheduled, uncounted, and queues NOTHING', async () => {
      const sendAt = ahead(DAY);
      const res = await send(adminJwt, { ...broadcast, sendAt }).expect(201);

      expect((res.body as Success<Broadcast>).data).toMatchObject({
        eventId: summitId,
        queued: false,
        scheduledFor: sendAt,
      });
      const [only] = (
        await pool.query<Row>(
          `SELECT status, scheduled_for, sent_at, recipient_count
           FROM announcements WHERE organization_id = $1`,
          [orgId],
        )
      ).rows;
      expect(only).toMatchObject({
        status: 'scheduled',
        sent_at: null,
        recipient_count: null,
      });
      expect(only.scheduled_for?.toISOString()).toBe(sendAt);
      // The whole point: an outbox row now would email everybody now.
      expect(await queuedSends()).toBe(0);
    });

    it('lists it as scheduled, with its time and NO count (not 0)', async () => {
      const sendAt = ahead(DAY);
      await send(adminJwt, { ...broadcast, sendAt }).expect(201);

      const [listed] = items((await list(adminJwt).expect(200)).body);
      expect(listed).toMatchObject({
        status: 'scheduled',
        scheduledFor: sendAt,
        sentAt: null,
        cancelledAt: null,
        recipientCount: null,
      });
    });

    it('lists what is still to come above what has gone', async () => {
      await send(adminJwt, { ...broadcast, subject: 'Sent now' }).expect(201);
      await send(adminJwt, {
        ...broadcast,
        subject: 'Next week',
        sendAt: ahead(7 * DAY),
      }).expect(201);

      const res = await list(adminJwt).expect(200);
      expect(items(res.body).map((a) => a.subject)).toEqual([
        'Next week',
        'Sent now',
      ]);
    });

    it('still sends straight away without a time — one row, one send', async () => {
      await send(adminJwt, broadcast).expect(201);

      const [listed] = items((await list(adminJwt).expect(200)).body);
      expect(listed).toMatchObject({
        status: 'sent',
        scheduledFor: null,
        recipientCount: 0,
      });
      expect(await queuedSends()).toBe(1);
    });

    it.each([
      ['already past', -MINUTE],
      ['too soon to change your mind about', 2 * MINUTE],
      ['more than a year out', 400 * DAY],
    ])('refuses a time %s, on the field, and writes nothing', async (_, ms) => {
      const res = await send(adminJwt, {
        ...broadcast,
        sendAt: ahead(ms),
      }).expect(422);

      expect(failure(res.body).errors?.[0].field).toBe('sendAt');
      const rows = await pool.query(
        `SELECT 1 FROM announcements WHERE organization_id = $1`,
        [orgId],
      );
      expect(rows.rowCount).toBe(0);
      expect(await queuedSends()).toBe(0);
    });

    it('refuses a time with no zone, which the server would have to guess', async () => {
      await send(adminJwt, { ...broadcast, sendAt: '2030-08-05T10:00' }).expect(
        400,
      );
    });
  });

  describe('cancelling one (TC-MSG-11, announcement X)', () => {
    it('cancels it as the person asking, and keeps it in the history', async () => {
      const id = await scheduled();

      const res = await cancel(adminJwt, id).expect(200);

      expect((res.body as Success<Announcement>).data).toMatchObject({
        id,
        status: 'cancelled',
      });
      expect(await row(id)).toMatchObject({
        status: 'cancelled',
        sent_at: null,
        cancelled_by_user_id: adminId,
      });
      const [listed] = items((await list(adminJwt).expect(200)).body);
      expect(listed).toMatchObject({ id, status: 'cancelled' });
      expect(listed.cancelledAt).not.toBeNull();
      expect(await queuedSends()).toBe(0);
    });

    it('says so when it is cancelled a second time', async () => {
      const id = await scheduled();
      await cancel(adminJwt, id).expect(200);

      const res = await cancel(adminJwt, id).expect(409);
      expect(failure(res.body).message).toBe(ALREADY_CANCELLED);
    });

    it('will not move a cancelled one back into the queue', async () => {
      const id = await scheduled();
      await cancel(adminJwt, id).expect(200);

      const res = await reschedule(adminJwt, id, ahead(2 * DAY)).expect(409);
      expect(failure(res.body).message).toBe(ALREADY_CANCELLED);
      expect((await row(id)).status).toBe('cancelled');
    });
  });

  describe('moving one (TC-MSG-11, announcement Y)', () => {
    it('moves it to the new time, still scheduled', async () => {
      const id = await scheduled(ahead(DAY));
      const later = ahead(2 * DAY);

      const res = await reschedule(adminJwt, id, later).expect(200);

      expect((res.body as Success<Announcement>).data).toMatchObject({
        id,
        status: 'scheduled',
        scheduledFor: later,
      });
      const moved = await row(id);
      expect(moved.status).toBe('scheduled');
      expect(moved.scheduled_for?.toISOString()).toBe(later);
      expect(await queuedSends()).toBe(0);
    });

    it('refuses a new time that is too soon, and leaves the old one', async () => {
      const original = ahead(DAY);
      const id = await scheduled(original);

      const res = await reschedule(adminJwt, id, ahead(MINUTE)).expect(422);

      expect(failure(res.body).errors?.[0].field).toBe('sendAt');
      expect((await row(id)).scheduled_for?.toISOString()).toBe(original);
    });
  });

  describe('once it has started sending (TC-MSG-12)', () => {
    it('refuses to cancel or move it, and changes nothing', async () => {
      const id = await scheduled();
      await sweepSends(id);

      const cancelled = await cancel(adminJwt, id).expect(409);
      const moved = await reschedule(adminJwt, id, ahead(2 * DAY)).expect(409);

      expect(failure(cancelled.body).message).toBe(ALREADY_SENT);
      expect(failure(moved.body).message).toBe(ALREADY_SENT);
      expect(await row(id)).toMatchObject({
        status: 'sent',
        cancelled_at: null,
      });
    });

    it('refuses a cancel that was waiting on the sweep’s lock when it committed', async () => {
      // The sweep holds the row while it sends. The cancel must wait for it
      // and then see `sent` — not act on the `scheduled` it read before.
      const id = await scheduled();
      const sweep = await pool.connect();
      try {
        await sweep.query('BEGIN');
        await sweep.query(
          `SELECT id FROM announcements WHERE id = $1 FOR UPDATE`,
          [id],
        );
        const pending = cancel(adminJwt, id).then((res) => res);
        await waitForLockWait(pool);
        await sweep.query(
          `UPDATE announcements SET status = 'sent', sent_at = now(), recipient_count = 0
           WHERE id = $1`,
          [id],
        );
        await sweep.query('COMMIT');

        const res = await pending;
        expect(res.status).toBe(409);
        expect(failure(res.body).message).toBe(ALREADY_SENT);
      } finally {
        sweep.release();
      }
      expect(await row(id)).toMatchObject({
        status: 'sent',
        cancelled_at: null,
      });
    });
  });

  describe('whose it is', () => {
    it('404s another workspace’s announcement, and leaves it alone', async () => {
      const id = await scheduled();

      await cancel(otherJwt, id).expect(404);
      await reschedule(otherJwt, id, ahead(2 * DAY)).expect(404);
      expect((await row(id)).status).toBe('scheduled');
    });

    it('404s one that does not exist', async () => {
      await cancel(adminJwt, '999999999').expect(404);
    });

    it('refuses a member without the attendee-data permission', async () => {
      const id = await scheduled();

      await cancel(outsiderJwt, id).expect(403);
      await reschedule(outsiderJwt, id, ahead(2 * DAY)).expect(403);
      expect((await row(id)).status).toBe('scheduled');
    });
  });
});

/**
 * Until some backend is waiting on a row lock for an UPDATE of announcements —
 * the API's cancel, queued behind the "sweep". Polled rather than slept, so the
 * test proves the wait happened instead of hoping it did.
 */
async function waitForLockWait(pool: Pool): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const res = await pool.query(
      `SELECT 1 FROM pg_stat_activity
       WHERE wait_event_type = 'Lock' AND query ILIKE 'update "announcements"%'`,
    );
    if (res.rowCount) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('the cancel never waited on the lock');
}

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
