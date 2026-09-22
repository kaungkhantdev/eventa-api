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
 * The delivery log (US-MSG-06) against a real database.
 *
 * eventa-worker writes these rows; this proves the half an organizer sees —
 * that the log narrows to the failures worth acting on, that the failure count
 * describes the filtered set rather than the workspace, and that one
 * workspace's mail never appears in another's.
 */

const PASSWORD = 'correct horse battery staple';
const ORG = { slug: 'del-e2e', name: 'Deliveries E2E' };
const ORG2 = { slug: 'del-e2e-2', name: 'Deliveries E2E 2' };
const ADMIN = 'admin@del-e2e.test';
const OUTSIDER = 'nobody@del-e2e.test';
const ADMIN2 = 'admin@del-e2e-2.test';

const PERM_GROUP: Record<string, string> = {
  regView: 'Registrations',
  evCreate: 'Events',
};

interface Success<T> {
  data: T;
  meta: { total: number; failed: number };
}
interface Delivery {
  id: string;
  kind: string;
  recipientEmail: string;
  recipientName: string | null;
  eventName: string | null;
  status: 'sent' | 'failed';
  error: string | null;
  sentAt: string;
}

describe('Delivery log (e2e — US-MSG-06)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let orgId: number;
  let otherOrgId: number;
  let summitId: string;
  let adminJwt: string;
  let outsiderJwt: string;
  let otherJwt: string;
  let seq = 0;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    orgId = await seedOrg(pool, ORG, [
      { email: ADMIN, roleName: 'Admin', grants: ['regView'] },
      { email: OUTSIDER, roleName: 'Marketing', grants: ['evCreate'] },
    ]);
    otherOrgId = await seedOrg(pool, ORG2, [
      { email: ADMIN2, roleName: 'Admin', grants: ['regView'] },
    ]);
    summitId = await seedEvent(pool, orgId, 'del-summit', 'Tech Summit 2026');

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
    await pool.query(
      `DELETE FROM message_deliveries WHERE organization_id = ANY($1)`,
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

  /** Stands in for eventa-worker, which is what writes these in production. */
  async function seedDelivery(o: {
    org?: number;
    kind?: string;
    email?: string;
    name?: string | null;
    event?: string | null;
    status?: 'sent' | 'failed';
    error?: string | null;
    minutesAgo?: number;
  }): Promise<void> {
    seq += 1;
    await pool.query(
      `INSERT INTO message_deliveries (organization_id, event_id, kind, recipient_email,
                                       recipient_name, status, error, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6::delivery_status,$7, now() - ($8 || ' minutes')::interval)`,
      [
        o.org ?? orgId,
        o.event === null ? null : (o.event ?? summitId),
        o.kind ?? 'registration-confirmation',
        o.email ?? `anong${seq}@x.test`,
        o.name === null ? null : (o.name ?? 'Anong Pattana'),
        o.status ?? 'sent',
        o.error ?? null,
        o.minutesAgo ?? seq,
      ],
    );
  }

  const list = (jwt: string, query = '') =>
    request(server)
      .get(`/api/v1/message-deliveries${query}`)
      .set('Authorization', `Bearer ${jwt}`);

  const rows = (body: unknown) => (body as Success<Delivery[]>).data;
  const meta = (body: unknown) => (body as Success<Delivery[]>).meta;

  describe('reading the log', () => {
    it('answers newest first, with the event named', async () => {
      await seedDelivery({ email: 'older@x.test', minutesAgo: 60 });
      await seedDelivery({ email: 'newer@x.test', minutesAgo: 1 });

      const res = await list(adminJwt).expect(200);
      expect(rows(res.body).map((r) => r.recipientEmail)).toEqual([
        'newer@x.test',
        'older@x.test',
      ]);
      expect(rows(res.body)[0].eventName).toBe('Tech Summit 2026');
    });

    it('carries the reason a failure failed', async () => {
      await seedDelivery({
        status: 'failed',
        error: 'smtp 550 mailbox unavailable',
      });

      const res = await list(adminJwt).expect(200);
      expect(rows(res.body)[0]).toMatchObject({
        status: 'failed',
        error: 'smtp 550 mailbox unavailable',
      });
    });

    it('keeps a delivery whose event has been deleted', async () => {
      const doomed = await seedEvent(pool, orgId, 'del-gone', 'Gone');
      await seedDelivery({ event: doomed });
      await pool.query(`DELETE FROM events WHERE id = $1`, [doomed]);

      const res = await list(adminJwt).expect(200);
      expect(rows(res.body)[0].eventName).toBeNull();
    });

    it('never shows another workspace’s mail, in either direction', async () => {
      await seedDelivery({ org: otherOrgId, email: 'theirs@x.test' });
      await seedDelivery({ email: 'ours@x.test' });

      const ours = await list(adminJwt).expect(200);
      expect(rows(ours.body).map((r) => r.recipientEmail)).toEqual([
        'ours@x.test',
      ]);

      const theirs = await list(otherJwt).expect(200);
      expect(rows(theirs.body).map((r) => r.recipientEmail)).toEqual([
        'theirs@x.test',
      ]);
    });

    it('refuses a member without the attendee-data permission', async () => {
      await list(outsiderJwt).expect(403);
    });
  });

  describe('narrowing it', () => {
    beforeEach(async () => {
      await seedDelivery({ email: 'ok@x.test', status: 'sent' });
      await seedDelivery({
        email: 'bounced@x.test',
        name: 'Somchai T.',
        status: 'failed',
        error: 'smtp 550',
      });
      await seedDelivery({ email: 'blast@x.test', kind: 'announcement' });
    });

    it('shows only the failures when asked', async () => {
      const res = await list(adminJwt, '?status=failed').expect(200);
      expect(rows(res.body).map((r) => r.recipientEmail)).toEqual([
        'bounced@x.test',
      ]);
    });

    it('counts the failures in the MATCHED set, not the workspace', async () => {
      // Filtered to announcements, none of which failed. A count of 1 here
      // would be describing a row that is not on the screen.
      const res = await list(adminJwt, '?kind=announcement').expect(200);
      expect(meta(res.body).total).toBe(1);
      expect(meta(res.body).failed).toBe(0);

      const all = await list(adminJwt).expect(200);
      expect(meta(all.body).failed).toBe(1);
    });

    it('finds someone by address or by name', async () => {
      const byAddress = await list(adminJwt, '?q=bounced').expect(200);
      expect(rows(byAddress.body)).toHaveLength(1);

      const byName = await list(adminJwt, '?q=somchai').expect(200);
      expect(rows(byName.body).map((r) => r.recipientEmail)).toEqual([
        'bounced@x.test',
      ]);
    });

    it('offers only the kinds this workspace has actually sent', async () => {
      const res = await request(server)
        .get('/api/v1/message-deliveries/kinds')
        .set('Authorization', `Bearer ${adminJwt}`)
        .expect(200);
      expect((res.body as Success<string[]>).data).toEqual([
        'announcement',
        'registration-confirmation',
      ]);
    });

    it('rejects a status that is not one', async () => {
      await list(adminJwt, '?status=opened').expect(400);
    });
  });

  describe('exporting it (US-MSG-07)', () => {
    const csv = (jwt: string, query = '') =>
      request(server)
        .get(`/api/v1/message-deliveries/export.csv${query}`)
        .set('Authorization', `Bearer ${jwt}`);

    it('downloads a BOM-first file, outside the JSON envelope', async () => {
      await seedDelivery({ email: 'anong@x.test' });

      const res = await csv(adminJwt).expect(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('delivery-log.csv');
      // Excel assumes the local codepage without it, and a Thai name opens as
      // mojibake.
      expect(res.text.charCodeAt(0)).toBe(0xfeff);
      expect(res.text).toContain('anong@x.test');
    });

    it('honours the filters, so the file is what was on screen', async () => {
      await seedDelivery({ email: 'ok@x.test', status: 'sent' });
      await seedDelivery({
        email: 'bounced@x.test',
        status: 'failed',
        error: 'smtp 550',
      });

      const res = await csv(adminJwt, '?status=failed').expect(200);
      expect(res.text).toContain('bounced@x.test');
      expect(res.text).not.toContain('ok@x.test');
      expect(res.text).toContain('smtp 550');
    });

    it('ignores paging — a paged export is a bug', async () => {
      await seedDelivery({ email: 'one@x.test' });
      await seedDelivery({ email: 'two@x.test' });

      const res = await csv(adminJwt, '?page=2&limit=1').expect(200);
      expect(res.text).toContain('one@x.test');
      expect(res.text).toContain('two@x.test');
    });

    it('refuses a member without the attendee-data permission', async () => {
      await csv(outsiderJwt).expect(403);
    });
  });

  it('is read-only — there is no way to re-send from here', async () => {
    // A retry button would fire the same message at the same dead address and
    // look like an action while changing nothing.
    await request(server)
      .post('/api/v1/message-deliveries')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({})
      .expect(404);
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
  // audit_events does NOT cascade from organizations, and signing in writes one.
  for (const table of [
    'audit_events',
    'outbox_events',
    'message_deliveries',
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
