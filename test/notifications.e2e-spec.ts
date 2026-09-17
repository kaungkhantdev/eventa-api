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

/**
 * The notification feed against a real database (US-MSG-03).
 *
 * The unit tests prove what unread means and who may see what, against fake
 * ports. What they cannot prove is that the three sources actually find their
 * rows, that a declined payment is stamped with the attempt rather than a
 * settlement it never had, that the watermark survives a round trip, and that
 * one workspace's feed never shows another's. That is what this covers.
 */

const PASSWORD = 'correct horse battery staple';
const ORG = { slug: 'ntf-e2e', name: 'Notifications E2E' };
const ORG2 = { slug: 'ntf-e2e-2', name: 'Notifications E2E 2' };
const ADMIN = 'admin@ntf-e2e.test';
const STAFF = 'staff@ntf-e2e.test';
const OUTSIDER = 'nobody@ntf-e2e.test';
const ADMIN2 = 'admin@ntf-e2e-2.test';

const PERM_GROUP: Record<string, string> = {
  regView: 'Registrations',
  finView: 'Finance',
  evCreate: 'Events',
};

interface Success<T> {
  data: T;
}
interface Item {
  id: string;
  kind: 'registration' | 'payment' | 'payout' | 'alert';
  at: string;
  unread: boolean;
  eventId: string | null;
  eventName: string | null;
  personName: string | null;
  amountSatang: number | null;
  seats: number | null;
  reference: string | null;
}
interface Feed {
  counts: { all: number; unread: number };
  groups: { bucket: string; recent: boolean; items: Item[] }[];
  readAt: string | null;
}

describe('Notifications (e2e — US-MSG-03)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let orgId: number;
  let otherOrgId: number;
  let summitId: string;
  let otherEventId: string;
  let adminJwt: string;
  let staffJwt: string;
  let outsiderJwt: string;
  let otherJwt: string;
  let seq = 0;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    orgId = await seedOrg(pool, ORG, [
      { email: ADMIN, roleName: 'Admin', grants: ['regView', 'finView'] },
      { email: STAFF, roleName: 'Staff', grants: ['regView'] },
      { email: OUTSIDER, roleName: 'Marketing', grants: ['evCreate'] },
    ]);
    otherOrgId = await seedOrg(pool, ORG2, [
      { email: ADMIN2, roleName: 'Admin', grants: ['regView', 'finView'] },
    ]);
    summitId = await seedEvent(pool, orgId, 'ntf-summit', 'Tech Summit 2026');
    otherEventId = await seedEvent(
      pool,
      otherOrgId,
      'ntf-other',
      'Other Org Event',
    );

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();
    server = app.getHttpServer() as Server;

    adminJwt = await token(ADMIN, ORG.slug);
    staffJwt = await token(STAFF, ORG.slug);
    outsiderJwt = await token(OUTSIDER, ORG.slug);
    otherJwt = await token(ADMIN2, ORG2.slug);
  }, 30000);

  afterEach(async () => {
    for (const table of ['payments', 'payouts', 'notification_reads']) {
      await pool.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [
        [orgId, otherOrgId],
      ]);
    }
    await pool.query(`DELETE FROM orders WHERE organization_id = ANY($1)`, [
      [orgId, otherOrgId],
    ]);
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

  async function seedOrder(o: {
    org?: number;
    event?: string;
    status?: string;
    seats?: number;
    buyer?: string;
    at?: string;
  }): Promise<string> {
    seq += 1;
    const res = await pool.query<{ id: string }>(
      `INSERT INTO orders (organization_id, reference, event_id, buyer_name, buyer_email,
                           status, payment_status, seats, subtotal_satang,
                           vat_amount_satang, total_satang, registered_at)
       VALUES ($1,$2,$3,$4,'anan@ntf.test',$5,'pending',$6,0,0,0, ${o.at ?? 'now()'})
       RETURNING id`,
      [
        o.org ?? orgId,
        `ORD-NTF-${seq}`,
        o.event ?? summitId,
        o.buyer ?? 'Anong Pattana',
        o.status ?? 'confirmed',
        o.seats ?? 1,
      ],
    );
    return res.rows[0].id;
  }

  /** A payment in whatever state, stamped where that state would stamp it. */
  async function seedPayment(o: {
    org?: number;
    event?: string;
    amountSatang: number;
    status?: 'paid' | 'failed' | 'pending';
    payer?: string;
    at?: string;
  }): Promise<void> {
    seq += 1;
    const org = o.org ?? orgId;
    const at = o.at ?? 'now()';
    const status = o.status ?? 'paid';
    const orderId = await seedOrder({ org, event: o.event, at });
    await pool.query(
      `INSERT INTO payments (organization_id, txn, order_id, event_id, payer_name, method,
                             amount_satang, status, paid_at, created_at, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,'Card',$6,$7::payment_status,
               ${status === 'paid' ? at : 'NULL'}, ${at}, $8)`,
      [
        org,
        `TXN-NTF-${seq}`,
        orderId,
        o.event ?? (org === orgId ? summitId : otherEventId),
        o.payer ?? 'Ploy Srisai',
        o.amountSatang,
        status,
        `idem-ntf-${seq}`,
      ],
    );
  }

  async function seedPayout(o: {
    org?: number;
    amountSatang: number;
    status?: string;
    at?: string;
  }): Promise<void> {
    seq += 1;
    const at = o.at ?? 'now()';
    const status = o.status ?? 'paid';
    await pool.query(
      `INSERT INTO payouts (organization_id, reference, amount_satang, bank_account,
                            status, requested_at, completed_at)
       VALUES ($1,$2,$3,'••••4321',$4::payout_status, ${at},
               ${status === 'paid' ? at : 'NULL'})`,
      [o.org ?? orgId, `PO-NTF-${seq}`, o.amountSatang, status],
    );
  }

  const get = (jwt: string, query = '') =>
    request(server)
      .get(`/api/v1/notifications${query}`)
      .set('Authorization', `Bearer ${jwt}`);

  const markRead = (jwt: string) =>
    request(server)
      .post('/api/v1/notifications/read')
      .set('Authorization', `Bearer ${jwt}`);

  const feed = (res: { body: unknown }) => (res.body as Success<Feed>).data;
  const itemsOf = (f: Feed) => f.groups.flatMap((g) => g.items);

  describe('what reaches the feed', () => {
    it('carries a confirmed registration, with who and how many seats', async () => {
      await seedOrder({ seats: 3, buyer: 'Anong Pattana' });

      const [item] = itemsOf(feed(await get(adminJwt).expect(200)));
      expect(item.kind).toBe('registration');
      expect(item.personName).toBe('Anong Pattana');
      expect(item.seats).toBe(3);
      expect(item.eventName).toBe('Tech Summit 2026');
      // Registration items are shown to anyone with regView, so they must not
      // carry money.
      expect(item.amountSatang).toBeNull();
    });

    it('leaves out an unfinished checkout', async () => {
      // A pending order is a hold that may never become a registration.
      await seedOrder({ status: 'pending' });
      expect(feed(await get(adminJwt).expect(200)).counts.all).toBe(0);
    });

    it('carries a settled payment with its amount in satang', async () => {
      await seedPayment({ amountSatang: 125_000, payer: 'Ploy Srisai' });

      const item = itemsOf(feed(await get(adminJwt).expect(200))).find(
        (i) => i.kind === 'payment',
      )!;
      expect(item.amountSatang).toBe(125_000);
      expect(item.personName).toBe('Ploy Srisai');
    });

    it('carries a declined payment as an alert', async () => {
      await seedPayment({ amountSatang: 90_000, status: 'failed' });

      const kinds = itemsOf(feed(await get(adminJwt).expect(200))).map(
        (i) => i.kind,
      );
      expect(kinds).toContain('alert');
      expect(kinds).not.toContain('payment');
    });

    it('leaves out a charge still in flight', async () => {
      await seedPayment({ amountSatang: 50_000, status: 'pending' });

      const kinds = itemsOf(feed(await get(adminJwt).expect(200))).map(
        (i) => i.kind,
      );
      expect(kinds).not.toContain('payment');
      expect(kinds).not.toContain('alert');
    });

    it('carries a completed payout with its reference and no person', async () => {
      await seedPayout({ amountSatang: 4_829_000 });

      const item = itemsOf(feed(await get(adminJwt).expect(200))).find(
        (i) => i.kind === 'payout',
      )!;
      expect(item.amountSatang).toBe(4_829_000);
      expect(item.reference).toMatch(/^PO-NTF-/);
      // The money went to the workspace's own bank; nobody is named.
      expect(item.personName).toBeNull();
    });

    it('leaves out a payout that has not reached the bank', async () => {
      await seedPayout({ amountSatang: 100_000, status: 'processing' });
      expect(feed(await get(adminJwt).expect(200)).counts.all).toBe(0);
    });

    it('leaves out anything older than the feed’s window', async () => {
      await seedOrder({ at: `now() - interval '40 days'` });
      await seedOrder({ at: 'now()' });
      expect(feed(await get(adminJwt).expect(200)).counts.all).toBe(1);
    });

    it('merges every source into one list, newest first', async () => {
      await seedPayout({
        amountSatang: 1_000,
        at: `now() - interval '2 days'`,
      });
      await seedPayment({
        amountSatang: 2_000,
        at: `now() - interval '1 hour'`,
      });
      await seedOrder({ at: 'now()' });

      const items = itemsOf(feed(await get(adminJwt).expect(200)));
      // Four items from three seeds: a paid order is a registration as well as
      // a payment, and the feed reports both, exactly as the kit shows them.
      expect(items).toHaveLength(4);
      expect(new Set(items.map((i) => i.kind))).toEqual(
        new Set(['registration', 'payment', 'payout']),
      );
      const times = items.map((i) => Date.parse(i.at));
      expect(times).toEqual([...times].sort((a, b) => b - a));
    });

    it('groups by recency, with this week open by default', async () => {
      await seedOrder({ at: 'now()' });
      const groups = feed(await get(adminJwt).expect(200)).groups;
      expect(groups[0].bucket).toBe('today');
      expect(groups[0].recent).toBe(true);
    });
  });

  describe('unread and marking read', () => {
    it('counts everything as unread for a member who has never looked', async () => {
      await seedOrder({});
      await seedPayment({ amountSatang: 10_000 });

      const f = feed(await get(adminJwt).expect(200));
      expect(f.counts).toEqual({ all: 3, unread: 3 });
      expect(f.readAt).toBeNull();
    });

    it('drops the unread count to zero and keeps it there after a reload', async () => {
      // TC-MSG-07: the persistence the whole watermark exists for.
      await seedOrder({});
      expect(feed(await get(adminJwt).expect(200)).counts.unread).toBe(1);

      const marked = await markRead(adminJwt).expect(200);
      expect((marked.body as Success<{ unread: number }>).data.unread).toBe(0);

      const after = feed(await get(adminJwt).expect(200));
      expect(after.counts).toEqual({ all: 1, unread: 0 });
      expect(after.readAt).toEqual(expect.any(String));
    });

    it('makes something that happens afterwards unread again', async () => {
      await seedOrder({});
      await markRead(adminJwt).expect(200);
      await seedOrder({ buyer: 'Somchai Wong' });

      const f = feed(await get(adminJwt).expect(200));
      expect(f.counts).toEqual({ all: 2, unread: 1 });
      expect(itemsOf(f).find((i) => i.unread)!.personName).toBe('Somchai Wong');
    });

    it('clears one member’s feed without touching another’s', async () => {
      await seedOrder({});
      await markRead(adminJwt).expect(200);

      expect(feed(await get(adminJwt).expect(200)).counts.unread).toBe(0);
      expect(feed(await get(staffJwt).expect(200)).counts.unread).toBe(1);
    });

    it('can be marked read twice without complaint', async () => {
      // Two tabs, or a double click: the upsert must not collide on its key.
      await seedOrder({});
      await markRead(adminJwt).expect(200);
      await markRead(adminJwt).expect(200);
      expect(feed(await get(adminJwt).expect(200)).counts.unread).toBe(0);
    });
  });

  describe('the unread filter', () => {
    it('shows only unread items while both counts stay whole', async () => {
      await seedOrder({ buyer: 'Read Already' });
      await markRead(adminJwt).expect(200);
      await seedOrder({ buyer: 'Brand New' });

      const f = feed(await get(adminJwt, '?unreadOnly=true').expect(200));
      expect(itemsOf(f).map((i) => i.personName)).toEqual(['Brand New']);
      // The All tab keeps its number while Unread is being looked at.
      expect(f.counts).toEqual({ all: 2, unread: 1 });
    });

    it('returns nothing to show once everything is read', async () => {
      // What "you’re all caught up" is rendered from.
      await seedOrder({});
      await markRead(adminJwt).expect(200);

      const f = feed(await get(adminJwt, '?unreadOnly=true').expect(200));
      expect(f.groups).toEqual([]);
      expect(f.counts.unread).toBe(0);
    });
  });

  describe('who sees what (US-MSG-03)', () => {
    it('never shows money to a member without finance access', async () => {
      await seedOrder({});
      await seedPayment({ amountSatang: 10_000 });
      await seedPayout({ amountSatang: 20_000 });

      const kinds = itemsOf(feed(await get(staffJwt).expect(200))).map(
        (i) => i.kind,
      );
      expect(kinds).toEqual(['registration', 'registration']);
    });

    it('counts unread over what that member may see', async () => {
      // Otherwise staff read "3 unread" and can only ever find two.
      await seedOrder({});
      await seedPayout({ amountSatang: 20_000 });

      expect(feed(await get(adminJwt).expect(200)).counts.all).toBe(2);
      expect(feed(await get(staffJwt).expect(200)).counts.all).toBe(1);
    });

    it('answers a member entitled to nothing with an empty feed, not a refusal', async () => {
      // A 403 would tell them there is something there to be refused.
      await seedOrder({});
      const f = feed(await get(outsiderJwt).expect(200));
      expect(f.groups).toEqual([]);
      expect(f.counts).toEqual({ all: 0, unread: 0 });
    });

    it('refuses an unauthenticated caller', async () => {
      await request(server).get('/api/v1/notifications').expect(401);
    });

    it('never shows another workspace’s activity', async () => {
      await seedOrder({
        org: otherOrgId,
        event: otherEventId,
        buyer: 'Theirs',
      });
      await seedOrder({ org: orgId, event: summitId, buyer: 'Mine' });

      expect(
        itemsOf(feed(await get(adminJwt).expect(200))).map((i) => i.personName),
      ).toEqual(['Mine']);
      expect(
        itemsOf(feed(await get(otherJwt).expect(200))).map((i) => i.personName),
      ).toEqual(['Theirs']);
    });

    it('keeps one workspace’s watermark out of another’s', async () => {
      await seedOrder({ org: otherOrgId, event: otherEventId });
      await seedOrder({ org: orgId, event: summitId });
      await markRead(adminJwt).expect(200);

      expect(feed(await get(otherJwt).expect(200)).counts.unread).toBe(1);
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
    'notification_reads',
    'refunds',
    'payments',
    'payout_items',
    'payouts',
    'check_ins',
    'tickets',
    'order_items',
    'orders',
    'ticket_types',
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
