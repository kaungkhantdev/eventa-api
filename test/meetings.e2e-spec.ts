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
const ORG = { slug: 'mtg-e2e', name: 'Meetings E2E' };
const ORG2 = { slug: 'mtg-e2e-2', name: 'Meetings E2E 2' };
const ADMIN = 'admin@mtg-e2e.test';
const ADMIN2 = 'admin@mtg-e2e-2.test';

interface Success<T> {
  data: T;
  meta?: { counts: Counts; emptyMessage: string | null; total: number };
}
interface Counts {
  all: number;
  today: number;
  upcoming: number;
  past: number;
}
interface Meeting {
  id: string;
  title: string;
  bucket: string;
  isToday: boolean;
  timeLabel: string;
  mode: string;
  status: string;
  place: string | null;
  link: string | null;
  syncStatus: string;
  canJoin: boolean;
  canEdit: boolean;
  eventName: string | null;
  version: number;
}
interface Failure {
  message: string;
}

/** A Bangkok calendar day offset from today, as `YYYY-MM-DD`. */
const bangkokDay = (offset: number): string => {
  const ms = Date.now() + 7 * 60 * 60 * 1000 + offset * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
};

describe('Meetings (e2e — E12)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let orgId: number;
  let otherOrgId: number;
  let eventId: string;
  let otherEventId: string;
  let jwt: string;
  let otherJwt: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    orgId = await seedOrg(pool, ORG, ADMIN);
    otherOrgId = await seedOrg(pool, ORG2, ADMIN2);
    eventId = await seedEvent(pool, orgId, 'mtg-jazz', 'Jazz Festival');
    otherEventId = await seedEvent(
      pool,
      otherOrgId,
      'mtg-other',
      'Their Event',
    );

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();
    server = app.getHttpServer() as Server;

    jwt = await token(ADMIN, ORG.slug);
    otherJwt = await token(ADMIN2, ORG2.slug);
  }, 30000);

  afterEach(async () => {
    await pool.query(`DELETE FROM meetings WHERE organization_id = ANY($1)`, [
      [orgId, otherOrgId],
    ]);
    await pool.query(
      `DELETE FROM outbox_events WHERE organization_id = ANY($1)`,
      [[orgId, otherOrgId]],
    );
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

  const schedule = (body: object, as = jwt) =>
    request(server)
      .post('/api/v1/meetings')
      .set('Authorization', `Bearer ${as}`)
      .send(body);

  const list = (qs = '', as = jwt) =>
    request(server)
      .get(`/api/v1/meetings${qs}`)
      .set('Authorization', `Bearer ${as}`);

  const meeting = (o: Record<string, unknown> = {}) => ({
    title: 'Venue walkthrough',
    date: bangkokDay(3),
    startTime: '09:00',
    endTime: '10:00',
    type: 'Venue',
    mode: 'Video',
    person: 'Khun Malee',
    role: 'Venue manager',
    guestEmail: 'malee@venue.co.th',
    eventId,
    ...o,
  });

  const created = (res: request.Response) =>
    (res.body as Success<Meeting>).data;

  describe('scheduling (US-MTG-03)', () => {
    it('creates a scheduled meeting in the right group', async () => {
      const res = await schedule(meeting());
      expect(res.status).toBe(201);
      const m = created(res);
      expect(m.status).toBe('scheduled');
      expect(m.bucket).toBe('upcoming');
      expect(m.canEdit).toBe(true);
    });

    it('marks a meeting for today as Today, with the story’s time label', async () => {
      const res = await schedule(meeting({ date: bangkokDay(0) }));
      const m = created(res);
      expect(m.isToday).toBe(true);
      expect(m.timeLabel).toBe('Today · 09:00 – 10:00');
    });

    it('refuses a date in the past', async () => {
      const res = await schedule(meeting({ date: bangkokDay(-1) }));
      expect(res.status).toBe(422);
      expect((res.body as Failure).message).toMatch(/passed/i);
    });

    it('refuses an end time that is not after the start', async () => {
      const res = await schedule(
        meeting({ startTime: '10:00', endTime: '09:00' }),
      );
      expect(res.status).toBe(422);
    });

    it('refuses a title that is too short', async () => {
      expect((await schedule(meeting({ title: 'a' }))).status).toBe(400);
    });

    it('refuses a malformed time', async () => {
      expect((await schedule(meeting({ startTime: '9am' }))).status).toBe(400);
    });

    it('refuses an invalid guest email', async () => {
      expect((await schedule(meeting({ guestEmail: 'nope' }))).status).toBe(
        400,
      );
    });

    it('shows the event venue for an in-person meeting', async () => {
      const m = created(await schedule(meeting({ mode: 'In person' })));
      expect(m.place).toBe('QSNCC Hall 2');
    });

    it('says "Phone call" for a phone meeting', async () => {
      const m = created(await schedule(meeting({ mode: 'Phone' })));
      expect(m.place).toBe('Phone call');
    });

    it('allows a general meeting tied to no event', async () => {
      const res = await schedule(meeting({ eventId: undefined }));
      expect(res.status).toBe(201);
    });

    it('refuses an event belonging to another workspace', async () => {
      const res = await schedule(meeting({ eventId: otherEventId }));
      expect(res.status).toBe(422);
    });

    it('creates ONE meeting when the form is double-submitted', async () => {
      const body = meeting({ idempotencyKey: 'double-tap-1' });
      const first = await schedule(body);
      const second = await schedule(body);
      expect(created(second).id).toBe(created(first).id);
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*) FROM meetings WHERE organization_id = $1`,
        [orgId],
      );
      expect(Number(rows[0].count)).toBe(1);
    });

    it('asks the calendar exactly once for a double-submitted form', async () => {
      const body = meeting({ idempotencyKey: 'double-tap-2' });
      await schedule(body);
      await schedule(body);
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*) FROM outbox_events WHERE organization_id = $1`,
        [orgId],
      );
      expect(Number(rows[0].count)).toBe(1);
    });
  });

  describe('the calendar is never in the write path (US-MTG-04)', () => {
    it('keeps the meeting and marks it not yet synced', async () => {
      const m = created(await schedule(meeting()));
      expect(m.syncStatus).toBe('pending');
      expect(m.link).toBeNull();
    });

    it('queues the invite in the same transaction', async () => {
      const m = created(await schedule(meeting()));
      const { rows } = await pool.query<{
        routing_key: string;
        payload: { intent: string; needsLink: boolean; startsAt: string };
      }>(
        `SELECT routing_key, payload FROM outbox_events WHERE aggregate_id = $1`,
        [m.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].routing_key).toBe('meeting.sync_requested');
      expect(rows[0].payload.intent).toBe('create');
      expect(rows[0].payload.needsLink).toBe(true);
      // 09:00 Bangkok is 02:00 UTC — the calendar gets an instant.
      expect(rows[0].payload.startsAt).toMatch(/T02:00:00\.000Z$/);
    });

    it('re-asks the calendar on retry', async () => {
      const m = created(await schedule(meeting()));
      await pool.query(
        `UPDATE meetings SET sync_status = 'failed', sync_error = 'timeout' WHERE id = $1`,
        [m.id],
      );
      const res = await request(server)
        .post(`/api/v1/meetings/${m.id}/sync`)
        .set('Authorization', `Bearer ${jwt}`)
        .send();
      expect(res.status).toBe(201);
      expect(created(res).syncStatus).toBe('pending');
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*) FROM outbox_events WHERE aggregate_id = $1`,
        [m.id],
      );
      expect(Number(rows[0].count)).toBe(2);
    });
  });

  describe('joining (US-MTG-07)', () => {
    const withLink = async (date: string) => {
      const m = created(await schedule(meeting({ date })));
      await pool.query(`UPDATE meetings SET link = $1 WHERE id = $2`, [
        'https://meet.example/abc',
        m.id,
      ]);
      return m.id;
    };

    it('offers Join for an upcoming video meeting whose link is ready', async () => {
      await withLink(bangkokDay(2));
      const res = await list('?bucket=upcoming');
      expect((res.body as Success<Meeting[]>).data[0].canJoin).toBe(true);
    });

    it('offers no Join while the link is not ready', async () => {
      await schedule(meeting());
      const res = await list('?bucket=upcoming');
      expect((res.body as Success<Meeting[]>).data[0].canJoin).toBe(false);
    });

    it('offers no Join for an in-person meeting', async () => {
      await schedule(meeting({ mode: 'In person' }));
      const res = await list('?bucket=upcoming');
      expect((res.body as Success<Meeting[]>).data[0].canJoin).toBe(false);
    });
  });

  describe('the Today / Upcoming / Past tabs (US-MTG-01)', () => {
    beforeEach(async () => {
      await schedule(meeting({ date: bangkokDay(0), title: 'Today one' }));
      await schedule(meeting({ date: bangkokDay(5), title: 'Later' }));
      await schedule(meeting({ date: bangkokDay(2), title: 'Sooner' }));
      // Past meetings cannot be scheduled, so one is backdated directly.
      const m = created(await schedule(meeting({ title: 'Was' })));
      await pool.query(`UPDATE meetings SET meeting_date = $1 WHERE id = $2`, [
        bangkokDay(-4),
        m.id,
      ]);
    });

    it('counts every tab, and the counts ignore the tab being viewed', async () => {
      const res = await list('?bucket=today');
      const counts = (res.body as Success<Meeting[]>).meta?.counts;
      expect(counts).toEqual({ all: 4, today: 1, upcoming: 2, past: 1 });
    });

    it('lists upcoming meetings earliest first', async () => {
      const res = await list('?bucket=upcoming');
      const titles = (res.body as Success<Meeting[]>).data.map((m) => m.title);
      expect(titles).toEqual(['Sooner', 'Later']);
    });

    it('puts a backdated meeting in Past', async () => {
      const res = await list('?bucket=past');
      expect((res.body as Success<Meeting[]>).data[0].title).toBe('Was');
    });
  });

  describe('finding a meeting (US-MTG-02)', () => {
    beforeEach(async () => {
      await schedule(meeting({ title: 'Sponsor sync', type: 'Sponsor' }));
      await schedule(
        meeting({
          title: 'Catering call',
          type: 'Vendor',
          person: 'Khun Somchai',
        }),
      );
    });

    it('searches the title', async () => {
      const res = await list('?search=catering');
      expect((res.body as Success<Meeting[]>).data).toHaveLength(1);
    });

    it('searches the person', async () => {
      const res = await list('?search=Somchai');
      expect((res.body as Success<Meeting[]>).data[0].title).toBe(
        'Catering call',
      );
    });

    it('searches the EVENT name, not just the meeting’s own fields', async () => {
      const res = await list('?search=Jazz');
      expect((res.body as Success<Meeting[]>).data.length).toBeGreaterThan(0);
    });

    it('filters by type, combined with the tab', async () => {
      const res = await list('?type=Sponsor&bucket=upcoming');
      const data = (res.body as Success<Meeting[]>).data;
      expect(data).toHaveLength(1);
      expect(data[0].title).toBe('Sponsor sync');
    });

    it('says so clearly when nothing matches', async () => {
      const res = await list('?search=nothing-like-this');
      expect((res.body as Success<Meeting[]>).data).toHaveLength(0);
      expect((res.body as Success<Meeting[]>).meta?.emptyMessage).toMatch(
        /no meetings match/i,
      );
    });

    it('pages, reporting the total for the summary line', async () => {
      const res = await list('?limit=1&page=1');
      expect((res.body as Success<Meeting[]>).data).toHaveLength(1);
      expect((res.body as Success<Meeting[]>).meta?.total).toBe(2);
    });

    it('labels each row with its event', async () => {
      const res = await list('?search=Sponsor');
      expect((res.body as Success<Meeting[]>).data[0].eventName).toBe(
        'Jazz Festival',
      );
    });
  });

  describe('rescheduling and cancelling (US-MTG-05/06)', () => {
    const patch = (id: string, body: object) =>
      request(server)
        .patch(`/api/v1/meetings/${id}`)
        .set('Authorization', `Bearer ${jwt}`)
        .send(body);

    it('moves the meeting and asks the calendar to amend the invite', async () => {
      const m = created(await schedule(meeting()));
      await pool.query(
        `UPDATE meetings SET external_event_id = 'gcal-1' WHERE id = $1`,
        [m.id],
      );
      const res = await patch(m.id, {
        version: m.version,
        startTime: '14:00',
        endTime: '15:00',
      });
      expect(res.status).toBe(200);
      expect(created(res).version).toBe(m.version + 1);
      const { rows } = await pool.query<{ payload: { intent: string } }>(
        `SELECT payload FROM outbox_events WHERE aggregate_id = $1 ORDER BY id DESC LIMIT 1`,
        [m.id],
      );
      expect(rows[0].payload.intent).toBe('update');
    });

    it('refuses a stale version rather than overwriting someone else’s edit', async () => {
      const m = created(await schedule(meeting()));
      await patch(m.id, { version: m.version, title: 'First edit wins' });
      const res = await patch(m.id, { version: m.version, title: 'Second' });
      expect(res.status).toBe(409);
      expect((res.body as Failure).message).toMatch(/reload/i);
    });

    it('drops the Meet link when the mode becomes in person', async () => {
      const m = created(await schedule(meeting()));
      await pool.query(
        `UPDATE meetings SET link = 'https://meet/x' WHERE id = $1`,
        [m.id],
      );
      const res = await patch(m.id, { version: m.version, mode: 'In person' });
      const updated = created(res);
      expect(updated.link).toBeNull();
      expect(updated.place).toBe('QSNCC Hall 2');
    });

    it('cancels, keeps the record, and withdraws the invite', async () => {
      const m = created(await schedule(meeting()));
      const res = await request(server)
        .post(`/api/v1/meetings/${m.id}/cancel`)
        .set('Authorization', `Bearer ${jwt}`)
        .send({ reason: 'Venue double-booked' });
      expect(res.status).toBe(201);
      const cancelled = created(res);
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.canEdit).toBe(false);
      expect(cancelled.canJoin).toBe(false);
      const { rows } = await pool.query<{ payload: { intent: string } }>(
        `SELECT payload FROM outbox_events WHERE aggregate_id = $1 ORDER BY id DESC LIMIT 1`,
        [m.id],
      );
      expect(rows[0].payload.intent).toBe('cancel');
    });

    it('refuses to edit a cancelled meeting', async () => {
      const m = created(await schedule(meeting()));
      await request(server)
        .post(`/api/v1/meetings/${m.id}/cancel`)
        .set('Authorization', `Bearer ${jwt}`)
        .send({});
      const res = await patch(m.id, { version: m.version, title: 'Nope' });
      expect(res.status).toBe(409);
    });
  });

  describe('tenancy', () => {
    it('never shows another workspace’s diary', async () => {
      await schedule(meeting());
      const res = await list('', otherJwt);
      expect((res.body as Success<Meeting[]>).data).toHaveLength(0);
    });

    it('404s a meeting from another workspace', async () => {
      const m = created(await schedule(meeting()));
      const res = await request(server)
        .patch(`/api/v1/meetings/${m.id}`)
        .set('Authorization', `Bearer ${otherJwt}`)
        .send({ version: 1, title: 'Steal' });
      expect(res.status).toBe(404);
    });

    it('refuses an anonymous caller', async () => {
      expect((await request(server).get('/api/v1/meetings')).status).toBe(401);
    });
  });
});

async function seedOrg(
  pool: Pool,
  org: { slug: string; name: string },
  email: string,
): Promise<number> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
    [org.name, org.slug],
  );
  const orgId = Number(res.rows[0].id);
  const role = await pool.query<{ id: string }>(
    `INSERT INTO roles (organization_id, name, description) VALUES ($1, 'Admin', 'seed') RETURNING id`,
    [orgId],
  );
  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
     VALUES ($1, 'Seed', $2, 'admin', 'Active', $3) RETURNING id`,
    [orgId, email, await hash(PASSWORD)],
  );
  await pool.query(
    `INSERT INTO memberships (organization_id, user_id, role_id, role, status)
     VALUES ($1, $2, $3, 'Admin', 'Active')`,
    [orgId, user.rows[0].id, Number(role.rows[0].id)],
  );
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
             now() + interval '20 days', now() + interval '20 days' + interval '8 hours',
             'Asia/Bangkok','Acme','QSNCC Hall 2','Bangkok', now())
     RETURNING id`,
    [orgId, slug, name],
  );
  return res.rows[0].id;
}

async function cleanup(pool: Pool): Promise<void> {
  const slugs = [ORG.slug, ORG2.slug];
  for (const table of ['meetings', 'outbox_events', 'audit_events', 'events']) {
    await pool.query(
      `DELETE FROM ${table} WHERE organization_id IN
         (SELECT id FROM organizations WHERE slug = ANY($1))`,
      [slugs],
    );
  }
  await pool.query(`DELETE FROM organizations WHERE slug = ANY($1)`, [slugs]);
}
