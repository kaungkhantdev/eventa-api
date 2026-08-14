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
const ORG = { slug: 'dash-e2e', name: 'Dashboard E2E' };
const ORG2 = { slug: 'dash-e2e-2', name: 'Dashboard E2E 2' };
const ADMIN = 'admin@dash-e2e.test';
const STAFF = 'staff@dash-e2e.test';
const ADMIN2 = 'admin@dash-e2e-2.test';
const BAHT = 100;

interface Success<T> {
  data: T;
}
interface Change {
  direction: string;
  percent: number | null;
  improved: boolean | null;
}
interface Kpi {
  value: number | null;
  change: Change;
}
interface Home {
  greeting: string;
  today: {
    count: number;
    recent: { attendeeName: string; totalSatang: number | null }[];
    emptyMessage: string | null;
  } | null;
  alerts: {
    alerts: { kind: string; severity: string }[];
    emptyMessage: string | null;
  };
  generatedAt: string;
}
interface Analytics {
  kpis: {
    registrations: Kpi;
    revenueSatang: Kpi | null;
    upcomingEvents: Kpi;
    checkInRate: Kpi;
    capacityFilled: Kpi;
  };
  revenue: { range: string; totalSatang: number; points: unknown[] } | null;
  recent: { attendeeName: string; totalSatang: number | null }[];
  tierMix: { ticketTypeName: string; count: number; percent: number }[];
  sellingFast: {
    ticketTypeId: string;
    ticketTypeName: string;
    eventId: string;
    eventName: string;
    remaining: number;
    total: number;
  }[];
}

describe('Dashboard and operations home (e2e — E11)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let orgId: number;
  let otherOrgId: number;
  let eventId: string;
  let tierId: string;
  let adminJwt: string;
  let staffJwt: string;
  let otherJwt: string;
  let seq = 0;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    orgId = await seedOrg(pool, ORG, [
      {
        email: ADMIN,
        roleName: 'Admin',
        grants: ['regView', 'finView', 'evCreate'],
      },
      { email: STAFF, roleName: 'Staff', grants: ['regView'] },
    ]);
    otherOrgId = await seedOrg(pool, ORG2, [
      { email: ADMIN2, roleName: 'Admin', grants: ['regView', 'finView'] },
    ]);
    const seeded = await seedEvent(pool, orgId, 'dash-summit');
    eventId = seeded.eventId;
    tierId = seeded.tierId;

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
    otherJwt = await token(ADMIN2, ORG2.slug);
  }, 30000);

  afterEach(async () => {
    const orgs = [orgId, otherOrgId];
    for (const table of [
      'refunds',
      'payments',
      'check_ins',
      'tickets',
      'order_items',
      'orders',
    ]) {
      await pool.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [
        orgs,
      ]);
    }
    // Extra tiers a test added (everything but the seeded 'General') go, so a
    // stock level set for one case cannot decide the next one's panel.
    await pool.query(
      `DELETE FROM ticket_types WHERE organization_id = ANY($1) AND name <> 'General'`,
      [orgs],
    );
    await pool.query(
      `UPDATE ticket_types SET sold = 0, total = 100, status = 'onsale'
       WHERE organization_id = ANY($1)`,
      [orgs],
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

  /** A confirmed registration, optionally settled and/or checked in. */
  async function seedRegistration(
    o: {
      org?: number;
      event?: string;
      tier?: string;
      status?: string;
      totalSatang?: number;
      vatSatang?: number;
      paid?: boolean;
      registeredAt?: string;
    } = {},
  ): Promise<string> {
    seq += 1;
    const org = o.org ?? orgId;
    const event = o.event ?? eventId;
    const tier = o.tier ?? tierId;
    const total = o.totalSatang ?? 0;
    const at = o.registeredAt ?? 'now()';
    const order = await pool.query<{ id: string }>(
      `INSERT INTO orders (organization_id, reference, event_id, buyer_name, buyer_email,
                           status, payment_status, seats, subtotal_satang,
                           vat_amount_satang, total_satang, registered_at)
       VALUES ($1,$2,$3,'Anan Suksawat','anan@dash.test',$4,$5,1,$6,$7,$6, ${at})
       RETURNING id`,
      [
        org,
        `ORD-DASH-${seq}`,
        event,
        o.status ?? 'confirmed',
        o.paid ? 'paid' : 'pending',
        total,
        o.vatSatang ?? 0,
      ],
    );
    const orderId = order.rows[0].id;
    await pool.query(
      `INSERT INTO order_items (organization_id, order_id, ticket_type_id, quantity,
                                unit_price_satang, line_subtotal_satang)
       VALUES ($1,$2,$3,1,$4,$4)`,
      [org, orderId, tier, total],
    );
    if (o.paid) {
      await pool.query(
        `INSERT INTO payments (organization_id, txn, order_id, event_id, payer_name,
                               method, amount_satang, status, paid_at, idempotency_key)
         VALUES ($1,$2,$3,$4,'Anan','Card',$5,'paid', ${at}, $6)`,
        [org, `TXN-${seq}`, orderId, event, total, `idem-${seq}`],
      );
    }
    return orderId;
  }

  const home = (jwt: string, qs = '') =>
    request(server)
      .get(`/api/v1/dashboard/home${qs}`)
      .set('Authorization', `Bearer ${jwt}`);

  const dashboard = (jwt: string, qs = '') =>
    request(server)
      .get(`/api/v1/dashboard${qs}`)
      .set('Authorization', `Bearer ${jwt}`);

  describe('the operations home (US-DASH-01/02/06)', () => {
    it('greets the signed-in user by name', async () => {
      const res = await home(adminJwt);
      expect(res.status).toBe(200);
      const body = (res.body as Success<Home>).data;
      expect(body.greeting).toMatch(/^Good (morning|afternoon|evening), /);
    });

    it('greets in Thai when asked', async () => {
      const res = await home(adminJwt, '?language=th');
      expect((res.body as Success<Home>).data.greeting).toMatch(/สวัสดี/);
    });

    it("counts today's sign-ups and previews the newest", async () => {
      await seedRegistration();
      await seedRegistration();
      const res = await home(adminJwt);
      const body = (res.body as Success<Home>).data;
      expect(body.today?.count).toBe(2);
      expect(body.today?.recent[0].attendeeName).toBe('Anan Suksawat');
    });

    it('says so plainly when nobody has registered today', async () => {
      const res = await home(adminJwt);
      const body = (res.body as Success<Home>).data;
      expect(body.today?.count).toBe(0);
      expect(body.today?.emptyMessage).toMatch(/no registrations yet today/i);
    });

    it('does not count another workspace’s registrations', async () => {
      const theirs = await seedEvent(pool, otherOrgId, 'dash-theirs');
      await seedRegistration({
        org: otherOrgId,
        event: theirs.eventId,
        tier: theirs.tierId,
      });
      const res = await home(adminJwt);
      expect((res.body as Success<Home>).data.today?.count).toBe(0);
    });

    it('raises pending approvals as an alert with a link', async () => {
      await seedRegistration({ status: 'pending' });
      const res = await home(adminJwt);
      const { alerts } = (res.body as Success<Home>).data;
      expect(alerts.alerts.map((a) => a.kind)).toContain('pending_approvals');
    });

    it('raises a nearly-sold-out tier', async () => {
      await pool.query(
        `UPDATE ticket_types SET total = 10, sold = 9 WHERE id = $1`,
        [tierId],
      );
      const res = await home(adminJwt);
      const { alerts } = (res.body as Success<Home>).data;
      expect(alerts.alerts.map((a) => a.kind)).toContain('selling_out');
    });

    it('says you are all caught up when nothing is outstanding', async () => {
      const res = await home(adminJwt);
      const { alerts } = (res.body as Success<Home>).data;
      expect(alerts.alerts).toHaveLength(0);
      expect(alerts.emptyMessage).toMatch(/caught up/i);
    });

    it('masks the amount from a caller without finance access', async () => {
      await seedRegistration({ totalSatang: 1_000 * BAHT });
      const res = await home(staffJwt);
      const body = (res.body as Success<Home>).data;
      // Hidden, never zero (US-DASH-13).
      expect(body.today?.recent[0].totalSatang).toBeNull();
      expect(body.today?.recent[0].attendeeName).toBe('Anan Suksawat');
    });

    it('refuses an attendee outright', async () => {
      const res = await request(server).get('/api/v1/dashboard/home');
      expect(res.status).toBe(401);
    });
  });

  describe('the analytics dashboard (US-DASH-08/09/12)', () => {
    it('reports the KPI cards', async () => {
      await seedRegistration({
        totalSatang: 1_070 * BAHT,
        vatSatang: 70 * BAHT,
        paid: true,
      });
      const res = await dashboard(adminJwt);
      expect(res.status).toBe(200);
      const body = (res.body as Success<Analytics>).data;
      expect(body.kpis.registrations.value).toBe(1);
      expect(body.kpis.upcomingEvents.value).toBe(1);
    });

    it('reports revenue NET of VAT', async () => {
      await seedRegistration({
        totalSatang: 1_070 * BAHT,
        vatSatang: 70 * BAHT,
        paid: true,
      });
      const res = await dashboard(adminJwt);
      const body = (res.body as Success<Analytics>).data;
      expect(body.kpis.revenueSatang?.value).toBe(1_000 * BAHT);
    });

    it('takes refunds off the revenue too', async () => {
      const orderId = await seedRegistration({
        totalSatang: 1_070 * BAHT,
        vatSatang: 70 * BAHT,
        paid: true,
      });
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM payments WHERE order_id = $1`,
        [orderId],
      );
      await pool.query(
        `INSERT INTO refunds (organization_id, payment_id, order_id, amount_satang,
                              reason, status, idempotency_key, issued_by)
         VALUES ($1,$2,$3,$4,'test','succeeded',$5,
                 (SELECT id FROM users WHERE email = $6))`,
        [orgId, rows[0].id, orderId, 400 * BAHT, `ref-${orderId}`, ADMIN],
      );
      const res = await dashboard(adminJwt);
      const body = (res.body as Success<Analytics>).data;
      expect(body.kpis.revenueSatang?.value).toBe(600 * BAHT);
    });

    it('defaults to the yearly range, and the trend agrees with the KPI', async () => {
      await seedRegistration({
        totalSatang: 1_070 * BAHT,
        vatSatang: 70 * BAHT,
        paid: true,
      });
      const res = await dashboard(adminJwt);
      const body = (res.body as Success<Analytics>).data;
      expect(body.revenue?.range).toBe('year');
      expect(body.revenue?.totalSatang).toBe(body.kpis.revenueSatang?.value);
    });

    it('switches to the weekly range', async () => {
      const res = await dashboard(adminJwt, '?range=week');
      expect((res.body as Success<Analytics>).data.revenue?.range).toBe('week');
    });

    it('rejects a range it does not offer', async () => {
      expect((await dashboard(adminJwt, '?range=decade')).status).toBe(400);
    });

    it('withholds the WHOLE revenue section without finance access', async () => {
      await seedRegistration({ totalSatang: 1_070 * BAHT, paid: true });
      const res = await dashboard(staffJwt);
      const body = (res.body as Success<Analytics>).data;
      expect(body.revenue).toBeNull();
      expect(body.kpis.revenueSatang).toBeNull();
      // Every other card still renders.
      expect(body.kpis.registrations.value).toBe(1);
    });

    it('shows a neutral empty state, not a misleading zero, for check-in rate', async () => {
      const res = await dashboard(adminJwt);
      expect(
        (res.body as Success<Analytics>).data.kpis.checkInRate.value,
      ).toBeNull();
    });

    it('makes the tier mix agree with the registrations KPI', async () => {
      await seedRegistration();
      await seedRegistration();
      const res = await dashboard(adminJwt);
      const body = (res.body as Success<Analytics>).data;
      const total = body.tierMix.reduce((sum, t) => sum + t.count, 0);
      expect(total).toBe(body.kpis.registrations.value);
      expect(body.tierMix[0].percent).toBe(100);
    });

    it('hides the amount but keeps the rest of the recent table', async () => {
      await seedRegistration({ totalSatang: 500 * BAHT });
      const res = await dashboard(staffJwt);
      const body = (res.body as Success<Analytics>).data;
      expect(body.recent[0].totalSatang).toBeNull();
      expect(body.recent[0].attendeeName).toBe('Anan Suksawat');
    });

    it('lists tickets selling fast, scarcest first, with their event', async () => {
      // Two tiers past the low-stock threshold, the second the scarcer.
      await pool.query(
        `UPDATE ticket_types SET total = 100, sold = 90 WHERE id = $1`,
        [tierId],
      );
      const scarcest = await seedTier(pool, orgId, eventId, {
        name: 'Last few',
        total: 100,
        sold: 98,
      });

      const res = await dashboard(adminJwt);
      const { sellingFast } = (res.body as Success<Analytics>).data;

      expect(sellingFast.map((t) => t.ticketTypeName)).toEqual([
        'Last few',
        'General',
      ]);
      expect(sellingFast[0]).toMatchObject({
        ticketTypeId: scarcest,
        eventId,
        eventName: 'Dashboard Summit',
        remaining: 2,
        total: 100,
      });
    });

    it('leaves out a tier that is not close to selling out', async () => {
      await seedTier(pool, orgId, eventId, {
        name: 'Plenty',
        total: 100,
        sold: 10,
      });
      const res = await dashboard(adminJwt);
      const { sellingFast } = (res.body as Success<Analytics>).data;
      expect(sellingFast.map((t) => t.ticketTypeName)).not.toContain('Plenty');
    });

    it('never leaks another workspace’s figures', async () => {
      await seedRegistration({ totalSatang: 9_999 * BAHT, paid: true });
      const res = await dashboard(otherJwt);
      const body = (res.body as Success<Analytics>).data;
      expect(body.kpis.registrations.value).toBe(0);
      expect(body.kpis.revenueSatang?.value).toBe(0);
      expect(body.recent).toEqual([]);
    });
  });
});

const PERM_GROUP: Record<string, string> = {
  regView: 'Registrations',
  finView: 'Finance',
  evCreate: 'Events',
};

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
): Promise<{ eventId: string; tierId: string }> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO events (organization_id, slug, name, type, bucket, status, visibility,
                         start_at, end_at, timezone, organizer_name, venue_name, city, published_at)
     VALUES ($1,$2,'Dashboard Summit','Conference','active','live','public',
             now() + interval '10 days', now() + interval '10 days' + interval '8 hours',
             'Asia/Bangkok','Acme','QSNCC','Bangkok', now())
     RETURNING id`,
    [orgId, slug],
  );
  const eventId = res.rows[0].id;
  const tier = await pool.query<{ id: string }>(
    `INSERT INTO ticket_types (organization_id, event_id, name, price_satang,
                               status, total, sold, min_per_order, max_per_order)
     VALUES ($1,$2,'General',0,'onsale',100,0,1,8) RETURNING id`,
    [orgId, eventId],
  );
  return { eventId, tierId: tier.rows[0].id };
}

/** An extra tier on an existing event, for the selling-fast ordering. */
async function seedTier(
  pool: Pool,
  orgId: number,
  eventId: string,
  tier: { name: string; total: number; sold: number },
): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO ticket_types (organization_id, event_id, name, price_satang,
                               status, total, sold, min_per_order, max_per_order)
     VALUES ($1,$2,$3,0,'onsale',$4,$5,1,8) RETURNING id`,
    [orgId, eventId, tier.name, tier.total, tier.sold],
  );
  return res.rows[0].id;
}

async function cleanup(pool: Pool): Promise<void> {
  const slugs = [ORG.slug, ORG2.slug];
  // Order matters: tickets and check-ins reference events ON DELETE RESTRICT.
  for (const table of [
    'audit_events',
    'outbox_events',
    'refunds',
    'payments',
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
