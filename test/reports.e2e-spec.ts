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
 * The reporting surface against a real database (US-RPT-02/08/12).
 *
 * The unit tests prove the window arithmetic and the service's shape against a
 * fake port. What they cannot prove is the SQL: the grouping, the seat sums per
 * order state, the tenant scoping, and that the tiles are summed over the whole
 * filter rather than the page. That is what this covers.
 */

const PASSWORD = 'correct horse battery staple';
const ORG = { slug: 'rpt-e2e', name: 'Reports E2E' };
const ORG2 = { slug: 'rpt-e2e-2', name: 'Reports E2E 2' };
const ADMIN = 'admin@rpt-e2e.test';
const STAFF = 'staff@rpt-e2e.test';
const OUTSIDER = 'nobody@rpt-e2e.test';
const ADMIN2 = 'admin@rpt-e2e-2.test';

const PERM_GROUP: Record<string, string> = {
  regView: 'Registrations',
  finView: 'Finance',
  evCreate: 'Events',
};

interface Success<T> {
  data: T;
}
interface Change {
  direction: 'up' | 'down' | 'flat';
  percent: number | null;
  improved: boolean | null;
}
interface Split {
  confirmed: number;
  pending: number;
  waitlisted: number;
  cancelled: number;
  rejected: number;
  total: number;
}
interface Row extends Split {
  eventId: string;
  eventName: string;
  startAt: string;
}
interface Report {
  period: { from: string; to: string; days: number; trimmed: boolean };
  rows: Row[];
  totals: Split;
  changes: Record<keyof Split, Change>;
}
interface Money {
  grossSatang: number;
  vatSatang: number;
  refundsSatang: number;
  feesSatang: number;
  netSatang: number;
  settledSatang: number;
}
interface AttendanceRow {
  eventId: string;
  eventName: string;
  registered: number;
  checkedIn: number;
  noShows: number | null;
  attendanceRate: number | null;
  onTimeRate: number | null;
}
interface AttendanceReport {
  rows: AttendanceRow[];
  changes: Record<
    'checkedIn' | 'noShows' | 'attendanceRate' | 'onTimeRate',
    Change
  >;
  totals: {
    checkedIn: number;
    noShows: number | null;
    attendanceRate: number | null;
    onTimeRate: number | null;
  };
}
interface IncomeReport {
  period: { from: string; to: string; days: number; trimmed: boolean };
  rows: (Money & { eventId: string; eventName: string })[];
  totals: Money;
  changes: Record<keyof Money, Change>;
}
interface Kpi {
  value: number | null;
  change: Change;
}
interface Overview {
  period: { from: string; to: string; days: number; trimmed: boolean };
  kpis: {
    registrations: Kpi;
    attendanceRate: Kpi;
    revenueSatang: Kpi | null;
    averageTicketSatang: Kpi | null;
    refundRate: Kpi | null;
  };
  revenue: {
    granularity: 'day' | 'week' | 'month';
    totalSatang: number;
    change: Change;
    points: { at: string; netSatang: number }[];
  } | null;
  ticketMix: { ticketTypeName: string; seats: number; percent: number }[];
}

describe('Reports (e2e — US-RPT)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let orgId: number;
  let otherOrgId: number;
  let summitId: string;
  let galaId: string;
  let otherEventId: string;
  let adminJwt: string;
  let staffJwt: string;
  let outsiderJwt: string;
  let otherJwt: string;
  let seq = 0;
  const temporaryEvents: string[] = [];
  const temporaryCodes: string[] = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    orgId = await seedOrg(pool, ORG, [
      { email: ADMIN, roleName: 'Admin', grants: ['regView', 'finView'] },
      { email: STAFF, roleName: 'Staff', grants: ['regView'] },
      // US-RPT-12: an admin-console user with no registration access at all.
      { email: OUTSIDER, roleName: 'Marketing', grants: ['evCreate'] },
    ]);
    otherOrgId = await seedOrg(pool, ORG2, [
      { email: ADMIN2, roleName: 'Admin', grants: ['regView'] },
    ]);
    summitId = await seedEvent(pool, orgId, 'rpt-summit', 'Tech Summit 2026');
    galaId = await seedEvent(pool, orgId, 'rpt-gala', 'Charity Gala');
    otherEventId = await seedEvent(
      pool,
      otherOrgId,
      'rpt-other',
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
    for (const table of ['refunds', 'payments', 'tickets', 'order_items']) {
      await pool.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [
        [orgId, otherOrgId],
      ]);
    }
    await pool.query(`DELETE FROM orders WHERE organization_id = ANY($1)`, [
      [orgId, otherOrgId],
    ]);
    await pool.query(
      `DELETE FROM ticket_types WHERE organization_id = ANY($1) AND name LIKE 'Tier %'`,
      [[orgId, otherOrgId]],
    );
    if (temporaryCodes.length) {
      await pool.query(
        `DELETE FROM discount_redemptions WHERE discount_code_id = ANY($1)`,
        [temporaryCodes],
      );
      await pool.query(`DELETE FROM discount_codes WHERE id = ANY($1)`, [
        temporaryCodes.splice(0),
      ]);
    }
    if (temporaryEvents.length) {
      await pool.query(`DELETE FROM events WHERE id = ANY($1)`, [
        temporaryEvents.splice(0),
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

  /** One order, in whatever state and however many seats the case needs. */
  async function seedOrder(o: {
    org?: number;
    event?: string;
    status?: string;
    seats?: number;
    /** SQL for `registered_at`; defaults to now. */
    at?: string;
  }): Promise<void> {
    seq += 1;
    await pool.query(
      `INSERT INTO orders (organization_id, reference, event_id, buyer_name, buyer_email,
                           status, payment_status, seats, subtotal_satang,
                           vat_amount_satang, total_satang, registered_at)
       VALUES ($1,$2,$3,'Anan Suksawat','anan@rpt.test',$4,'pending',$5,0,0,0, ${o.at ?? 'now()'})`,
      [
        o.org ?? orgId,
        `ORD-RPT-${seq}`,
        o.event ?? summitId,
        o.status ?? 'confirmed',
        o.seats ?? 1,
      ],
    );
  }

  /** A settled payment against a fresh order, with optional refund and fee. */
  async function seedPayment(o: {
    org?: number;
    event?: string;
    amountSatang: number;
    vatSatang?: number;
    feeSatang?: number;
    refundSatang?: number;
    /** Seats on the order the payment settled — the average price's divisor. */
    seats?: number;
    /** Who paid, for the ledger's search and its person column. */
    payer?: string;
    /** `paid` unless a case needs a failure or a charge still in flight. */
    status?: 'paid' | 'pending' | 'failed';
    at?: string;
  }): Promise<void> {
    seq += 1;
    const org = o.org ?? orgId;
    const event = o.event ?? summitId;
    const at = o.at ?? 'now()';
    const order = await pool.query<{ id: string }>(
      `INSERT INTO orders (organization_id, reference, event_id, buyer_name, buyer_email,
                           status, payment_status, seats, subtotal_satang,
                           vat_amount_satang, total_satang, registered_at)
       VALUES ($1,$2,$3,'Anan Suksawat','anan@rpt.test','confirmed','paid',$6,$4,$5,$4, ${at})
       RETURNING id`,
      [
        org,
        `ORD-PAY-${seq}`,
        event,
        o.amountSatang,
        o.vatSatang ?? 0,
        o.seats ?? 1,
      ],
    );
    const orderId = order.rows[0].id;
    const payment = await pool.query<{ id: string }>(
      `INSERT INTO payments (organization_id, txn, order_id, event_id, payer_name, method,
                             amount_satang, fee_amount_satang, status, paid_at, created_at,
                             idempotency_key)
       VALUES ($1,$2,$3,$4,$8,'Card',$5,$6,$9::payment_status,
               ${(o.status ?? 'paid') === 'paid' ? at : 'NULL'}, ${at}, $7)
       RETURNING id`,
      [
        org,
        `TXN-RPT-${seq}`,
        orderId,
        event,
        o.amountSatang,
        o.feeSatang ?? 0,
        `idem-rpt-${seq}`,
        o.payer ?? 'Anan',
        o.status ?? 'paid',
      ],
    );
    if (o.refundSatang) {
      await pool.query(
        `INSERT INTO refunds (organization_id, payment_id, order_id, amount_satang, status,
                              issued_by, idempotency_key)
         VALUES ($1,$2,$3,$4,'succeeded',
                 (SELECT id FROM users WHERE organization_id = $1 LIMIT 1), $5)`,
        [org, payment.rows[0].id, orderId, o.refundSatang, `ref-rpt-${seq}`],
      );
    }
  }

  /** An event starting at an offset from now, for the started/not-started rule. */
  async function seedEventAt(
    slug: string,
    name: string,
    startsIn: string,
    over: { status?: string; runsFor?: string; venue?: string | null } = {},
  ) {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO events (organization_id, slug, name, type, bucket, status, visibility,
                           start_at, end_at, timezone, organizer_name, venue_name, city, published_at)
       VALUES ($1,$2,$3,'Conference','active',$5::event_status,'public',
               now() + ($4)::interval,
               now() + ($4)::interval + ($6)::interval,
               'Asia/Bangkok','Acme',$7,'Bangkok', now())
       RETURNING id`,
      [
        orgId,
        slug,
        name,
        startsIn,
        over.status ?? 'live',
        over.runsFor ?? '8 hours',
        over.venue === undefined ? 'QSNCC' : over.venue,
      ],
    );
    temporaryEvents.push(res.rows[0].id);
    return res.rows[0].id;
  }

  /** A live ticket, optionally used, optionally before the event began. */
  async function seedTicket(o: {
    event: string;
    checkedIn?: 'onTime' | 'late' | false;
  }): Promise<void> {
    seq += 1;
    const tier = await pool.query<{ id: string }>(
      `INSERT INTO ticket_types (organization_id, event_id, name, price_satang,
                                 status, total, sold, min_per_order, max_per_order)
       VALUES ($1,$2,$3,0,'onsale',100,0,1,8) RETURNING id`,
      [orgId, o.event, `Tier ${seq}`],
    );
    const order = await pool.query<{ id: string }>(
      `INSERT INTO orders (organization_id, reference, event_id, buyer_name, buyer_email,
                           status, payment_status, seats, subtotal_satang,
                           vat_amount_satang, total_satang)
       VALUES ($1,$2,$3,'Anan','anan@rpt.test','confirmed','paid',1,0,0,0)
       RETURNING id`,
      [orgId, `ORD-TK-${seq}`, o.event],
    );
    const item = await pool.query<{ id: string }>(
      `INSERT INTO order_items (organization_id, order_id, ticket_type_id, quantity,
                                unit_price_satang, line_subtotal_satang)
       VALUES ($1,$2,$3,1,0,0) RETURNING id`,
      [orgId, order.rows[0].id, tier.rows[0].id],
    );
    // The check-in instant is relative to the event's own start, so "on time"
    // and "late" mean the same thing here as they do in the report.
    const offset =
      o.checkedIn === 'onTime'
        ? `- interval '20 minutes'`
        : `+ interval '40 minutes'`;
    const checkedInAt = o.checkedIn
      ? `(SELECT start_at ${offset} FROM events WHERE id = $4)`
      : 'NULL';
    await pool.query(
      `INSERT INTO tickets (organization_id, order_id, order_item_id, event_id,
                            ticket_type_id, qr_token, status, checked_in_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::issued_ticket_status, ${checkedInAt})`,
      [
        orgId,
        order.rows[0].id,
        item.rows[0].id,
        o.event,
        tier.rows[0].id,
        `qr-rpt-${seq}`,
        o.checkedIn ? 'checked_in' : 'issued',
      ],
    );
  }

  const get = (jwt: string, query = '') =>
    request(server)
      .get(`/api/v1/reports/registrations${query}`)
      .set('Authorization', `Bearer ${jwt}`);

  const report = (res: { body: unknown }) => (res.body as Success<Report>).data;

  /** Bangkok calendar day, `days` from now. */
  const bkkDay = (days: number) =>
    new Date(Date.now() + days * 86_400_000 + 7 * 3_600_000)
      .toISOString()
      .slice(0, 10);

  /**
   * A window spanning a month either side of today. The named ranges all end at
   * the end of today, so an event still to come falls outside them entirely —
   * and then it would be the WINDOW excluding it from the overall rate, not the
   * rule under test.
   */
  const spanningWindow = () => `?from=${bkkDay(-30)}&to=${bkkDay(30)}`;

  const getAttendance = (jwt: string, query = '') =>
    request(server)
      .get(`/api/v1/reports/attendance${query}`)
      .set('Authorization', `Bearer ${jwt}`);

  const attendance = (res: { body: unknown }) =>
    (res.body as Success<AttendanceReport>).data;

  const getIncome = (jwt: string, query = '') =>
    request(server)
      .get(`/api/v1/reports/income${query}`)
      .set('Authorization', `Bearer ${jwt}`);

  const income = (res: { body: unknown }) =>
    (res.body as Success<IncomeReport>).data;

  const getOverview = (jwt: string, query = '') =>
    request(server)
      .get(`/api/v1/reports/overview${query}`)
      .set('Authorization', `Bearer ${jwt}`);

  const overview = (res: { body: unknown }) =>
    (res.body as Success<Overview>).data;

  describe('the split itself', () => {
    it('groups by event and counts each order state', async () => {
      await seedOrder({ status: 'confirmed' });
      await seedOrder({ status: 'pending' });
      await seedOrder({ status: 'waitlisted' });
      await seedOrder({ status: 'cancelled' });
      await seedOrder({ status: 'rejected' });

      const res = await get(adminJwt).expect(200);
      const row = report(res).rows.find((r) => r.eventId === summitId)!;

      expect(row.confirmed).toBe(1);
      expect(row.pending).toBe(1);
      expect(row.waitlisted).toBe(1);
      expect(row.cancelled).toBe(1);
      expect(row.rejected).toBe(1);
    });

    it('counts SEATS, not orders, so a group booking is not under-reported', async () => {
      await seedOrder({ status: 'confirmed', seats: 4 });
      const res = await get(adminJwt).expect(200);
      expect(report(res).rows[0].confirmed).toBe(4);
    });

    it('makes the parts sum to the whole', async () => {
      await seedOrder({ status: 'confirmed', seats: 3 });
      await seedOrder({ status: 'cancelled', seats: 2 });
      await seedOrder({ status: 'rejected' });

      const { total, confirmed, pending, waitlisted, cancelled, rejected } =
        report(await get(adminJwt).expect(200)).totals;
      expect(confirmed + pending + waitlisted + cancelled + rejected).toBe(
        total,
      );
      expect(total).toBe(6);
    });

    it('carries the event it belongs to', async () => {
      await seedOrder({ event: galaId });
      const row = report(await get(adminJwt).expect(200)).rows[0];
      expect(row.eventName).toBe('Charity Gala');
      expect(row.startAt).toEqual(expect.any(String));
    });
  });

  describe('the window', () => {
    it('leaves out registrations taken before it opens', async () => {
      await seedOrder({ at: `now() - interval '40 days'` });
      await seedOrder({ at: 'now()' });

      const res = await get(adminJwt, '?range=30d').expect(200);
      expect(report(res).totals.total).toBe(1);
    });

    it('includes the whole of the end day', async () => {
      // Registered this afternoon, with the window ending "today". An exclusive
      // end at today's midnight would drop it.
      await seedOrder({ at: 'now()' });
      const today = new Date(Date.now() + 7 * 3600_000)
        .toISOString()
        .slice(0, 10);

      const res = await get(adminJwt, `?from=${today}&to=${today}`).expect(200);
      expect(report(res).totals.total).toBe(1);
    });

    it('reports the days it covered, inclusive at both ends', async () => {
      const res = await get(adminJwt, '?from=2026-07-01&to=2026-07-07').expect(
        200,
      );
      expect(report(res).period).toMatchObject({
        from: '2026-07-01',
        to: '2026-07-07',
        days: 7,
        trimmed: false,
      });
    });

    it('trims a span beyond the cap and says so', async () => {
      const res = await get(adminJwt, '?from=2020-01-01&to=2026-07-19').expect(
        200,
      );
      expect(report(res).period.trimmed).toBe(true);
      expect(report(res).period.days).toBe(731);
    });

    it('refuses a backwards window with the message the story asks for', async () => {
      // 422, not 400: the dates are well-formed, so this is a domain rule
      // refusing them rather than the DTO failing to read them.
      const res = await get(adminJwt, '?from=2026-07-07&to=2026-07-01').expect(
        422,
      );
      expect((res.body as { message: string }).message).toContain(
        'End date must be on or after the start date',
      );
    });

    it('refuses a date it cannot read, as a malformed request', async () => {
      // 400 here: the DTO's own shape check rejects it before any rule runs.
      await get(adminJwt, '?from=yesterday&to=2026-07-01').expect(400);
    });
  });

  describe('filtering', () => {
    it('narrows to one event', async () => {
      await seedOrder({ event: summitId, seats: 2 });
      await seedOrder({ event: galaId, seats: 5 });

      const res = await get(adminJwt, `?eventId=${summitId}`).expect(200);
      expect(report(res).rows).toHaveLength(1);
      expect(report(res).totals.total).toBe(2);
    });

    it('recomputes the totals for the filter, not just the rows', async () => {
      // US-RPT-02: the tiles move with the filter too.
      await seedOrder({ event: summitId, seats: 2 });
      await seedOrder({ event: galaId, seats: 8 });

      const all = report(await get(adminJwt).expect(200));
      const one = report(await get(adminJwt, `?eventId=${galaId}`).expect(200));
      expect(all.totals.total).toBe(10);
      expect(one.totals.total).toBe(8);
    });

    it('searches on the event name', async () => {
      await seedOrder({ event: summitId });
      await seedOrder({ event: galaId });

      const res = await get(adminJwt, '?q=gala').expect(200);
      expect(report(res).rows).toHaveLength(1);
      expect(report(res).rows[0].eventName).toBe('Charity Gala');
    });

    it('answers a filter that matches nothing with zeros, not an error', async () => {
      await seedOrder({ event: summitId });
      const res = await get(adminJwt, '?q=no-such-event').expect(200);
      expect(report(res).rows).toEqual([]);
      expect(report(res).totals.total).toBe(0);
    });

    it('pages the rows while the totals stay whole', async () => {
      await seedOrder({ event: summitId, seats: 3 });
      await seedOrder({ event: galaId, seats: 4 });

      const page = report(await get(adminJwt, '?page=1&limit=1').expect(200));
      expect(page.rows).toHaveLength(1);
      // The tile still describes both events, which is the point of summing
      // over the filter rather than the page.
      expect(page.totals.total).toBe(7);
    });

    it('ranks the busiest event first', async () => {
      await seedOrder({ event: summitId, seats: 2 });
      await seedOrder({ event: galaId, seats: 8 });

      const rows = report(await get(adminJwt).expect(200)).rows;
      expect(rows.map((r) => r.eventName)).toEqual([
        'Charity Gala',
        'Tech Summit 2026',
      ]);
    });
  });

  describe('income (US-RPT-05)', () => {
    it('splits gross into VAT, refunds, fees and the two bottom lines', async () => {
      // ฿1,070 collected, of which ฿70 is VAT; ฿100 refunded, ฿30 in fees.
      await seedPayment({
        amountSatang: 107_000,
        vatSatang: 7_000,
        refundSatang: 10_000,
        feeSatang: 3_000,
      });

      const t = income(await getIncome(adminJwt).expect(200)).totals;
      expect(t.grossSatang).toBe(107_000);
      expect(t.vatSatang).toBe(7_000);
      expect(t.refundsSatang).toBe(10_000);
      expect(t.feesSatang).toBe(3_000);
      // net is gross less VAT and refunds — fees are NOT in it.
      expect(t.netSatang).toBe(90_000);
      // settled is what reaches the bank.
      expect(t.settledSatang).toBe(87_000);
    });

    it('agrees with the dashboard about the same money', async () => {
      // The whole point of sharing the arithmetic: the overview's revenue and
      // this report's net are the same number for the same scope (US-RPT-01).
      await seedPayment({
        amountSatang: 50_000,
        vatSatang: 3_500,
        feeSatang: 1_500,
      });

      const net = income(await getIncome(adminJwt).expect(200)).totals
        .netSatang;
      const dash = await request(server)
        .get('/api/v1/dashboard?range=year')
        .set('Authorization', `Bearer ${adminJwt}`)
        .expect(200);
      const revenue = (
        dash.body as Success<{
          kpis: { revenueSatang: { value: number | null } | null };
        }>
      ).data.kpis.revenueSatang;
      expect(revenue?.value).toBe(net);
    });

    it('does not double-count a payment refunded twice', async () => {
      // A correlated subquery, not a join: two refund rows must not duplicate
      // the payment's own amount into gross.
      await seedPayment({ amountSatang: 20_000, refundSatang: 5_000 });
      await pool.query(
        `INSERT INTO refunds (organization_id, payment_id, order_id, amount_satang, status,
                              issued_by, idempotency_key)
         SELECT organization_id, id, order_id, 5000, 'succeeded',
                (SELECT id FROM users WHERE organization_id = $1 LIMIT 1), 'ref-rpt-second'
         FROM payments WHERE organization_id = $1 LIMIT 1`,
        [orgId],
      );

      const t = income(await getIncome(adminJwt).expect(200)).totals;
      expect(t.grossSatang).toBe(20_000);
      expect(t.refundsSatang).toBe(10_000);
      expect(t.netSatang).toBe(10_000);
    });

    it('reports a free event as zeros rather than leaving it out', async () => {
      await seedPayment({ event: galaId, amountSatang: 0 });
      const row = income(await getIncome(adminJwt).expect(200)).rows[0];
      expect(row.eventName).toBe('Charity Gala');
      expect(row.grossSatang).toBe(0);
      expect(row.netSatang).toBe(0);
    });

    it('counts only payments settled inside the window', async () => {
      await seedPayment({
        amountSatang: 90_000,
        at: `now() - interval '40 days'`,
      });
      await seedPayment({ amountSatang: 10_000, at: 'now()' });

      const t = income(
        await getIncome(adminJwt, '?range=30d').expect(200),
      ).totals;
      expect(t.grossSatang).toBe(10_000);
    });

    it('narrows to one event, tiles included', async () => {
      await seedPayment({ event: summitId, amountSatang: 30_000 });
      await seedPayment({ event: galaId, amountSatang: 70_000 });

      const all = income(await getIncome(adminJwt).expect(200)).totals;
      const one = income(
        await getIncome(adminJwt, `?eventId=${galaId}`).expect(200),
      ).totals;
      expect(all.grossSatang).toBe(100_000);
      expect(one.grossSatang).toBe(70_000);
    });

    it('is finance-only: registration access is not enough', async () => {
      // US-RPT-12 — Staff may read registrations but never the money.
      await getIncome(staffJwt).expect(403);
      await getIncome(adminJwt).expect(200);
    });

    it('never reports another workspace’s money', async () => {
      await seedPayment({
        org: otherOrgId,
        event: otherEventId,
        amountSatang: 99_000,
      });
      await seedPayment({ org: orgId, event: summitId, amountSatang: 1_000 });

      expect(
        income(await getIncome(adminJwt).expect(200)).totals.grossSatang,
      ).toBe(1_000);
    });
  });

  describe('attendance (US-RPT-09)', () => {
    it('reports no-shows and the rate for a finished event', async () => {
      const past = await seedEventAt('rpt-past', 'Finished Summit', '-2 days');
      await seedTicket({ event: past, checkedIn: 'onTime' });
      await seedTicket({ event: past, checkedIn: 'onTime' });
      await seedTicket({ event: past, checkedIn: 'late' });
      await seedTicket({ event: past, checkedIn: false });

      const row = attendance(
        await getAttendance(adminJwt, '?q=Finished').expect(200),
      ).rows[0];
      expect(row.registered).toBe(4);
      expect(row.checkedIn).toBe(3);
      expect(row.noShows).toBe(1);
      expect(row.attendanceRate).toBe(75);
    });

    it('measures on-time against those who came', async () => {
      const past = await seedEventAt('rpt-past2', 'On Time Test', '-2 days');
      await seedTicket({ event: past, checkedIn: 'onTime' });
      await seedTicket({ event: past, checkedIn: 'late' });
      await seedTicket({ event: past, checkedIn: false });

      const row = attendance(
        await getAttendance(adminJwt, '?q=On+Time').expect(200),
      ).rows[0];
      // One of the two who arrived was on time: 50%, not 33%.
      expect(row.onTimeRate).toBe(50);
    });

    it('reports no rate for an event that has not started', async () => {
      const soon = await seedEventAt('rpt-soon', 'Not Yet Summit', '5 days');
      await seedTicket({ event: soon, checkedIn: false });
      await seedTicket({ event: soon, checkedIn: false });

      const row = attendance(
        await getAttendance(adminJwt, `${spanningWindow()}&q=Not+Yet`).expect(
          200,
        ),
      ).rows[0];
      expect(row.registered).toBe(2);
      expect(row.attendanceRate).toBeNull();
      expect(row.noShows).toBeNull();
    });

    it('leaves an unstarted event out of the overall rate', async () => {
      // The load-bearing case: two sold-out events, one finished with everyone
      // through the door, one still to come. The workspace is at 100%, not 50%.
      const past = await seedEventAt('rpt-a', 'Already Ran', '-2 days');
      const soon = await seedEventAt('rpt-b', 'Still To Come', '5 days');
      await seedTicket({ event: past, checkedIn: 'onTime' });
      await seedTicket({ event: past, checkedIn: 'onTime' });
      await seedTicket({ event: soon, checkedIn: false });
      await seedTicket({ event: soon, checkedIn: false });

      const totals = attendance(
        await getAttendance(adminJwt, spanningWindow()).expect(200),
      ).totals;
      // Both events are inside the window; the unstarted one is left out of the
      // rate by the rule, which is the thing being tested.
      expect(totals.attendanceRate).toBe(100);
      expect(totals.noShows).toBe(0);
      expect(totals.checkedIn).toBe(2);
    });

    it('reports 0% for a finished event nobody attended', async () => {
      const past = await seedEventAt('rpt-empty', 'Nobody Came', '-2 days');
      await seedTicket({ event: past, checkedIn: false });

      const row = attendance(
        await getAttendance(adminJwt, '?q=Nobody').expect(200),
      ).rows[0];
      expect(row.attendanceRate).toBe(0);
      expect(row.noShows).toBe(1);
    });

    it('is staff-readable, like registrations', async () => {
      await getAttendance(staffJwt).expect(200);
    });

    it('answers a filter matching nothing without erroring', async () => {
      const res = await getAttendance(adminJwt, '?q=no-such-event').expect(200);
      expect(attendance(res).rows).toEqual([]);
      expect(attendance(res).totals.attendanceRate).toBeNull();
    });
  });

  describe('tiles against the previous period (US-RPT-02)', () => {
    it('compares registrations with the window before this one', async () => {
      await seedOrder({ seats: 2, at: `now() - interval '40 days'` });
      await seedOrder({ seats: 4, at: 'now()' });

      const r = report(await get(adminJwt, '?range=30d').expect(200));
      expect(r.totals.confirmed).toBe(4);
      expect(r.changes.confirmed).toMatchObject({
        direction: 'up',
        percent: 100,
        improved: true,
      });
    });

    it('reads fewer cancellations as an improvement', async () => {
      await seedOrder({
        status: 'cancelled',
        seats: 4,
        at: `now() - interval '40 days'`,
      });
      await seedOrder({ status: 'cancelled', seats: 1, at: 'now()' });

      const r = report(await get(adminJwt, '?range=30d').expect(200));
      expect(r.changes.cancelled).toMatchObject({
        direction: 'down',
        improved: true,
      });
    });

    it('compares income with the window before this one', async () => {
      await seedPayment({
        amountSatang: 5_000,
        at: `now() - interval '40 days'`,
      });
      await seedPayment({ amountSatang: 10_000, at: 'now()' });

      const i = income(await getIncome(adminJwt, '?range=30d').expect(200));
      expect(i.changes.grossSatang).toMatchObject({
        direction: 'up',
        percent: 100,
        improved: true,
      });
    });

    it('passes no verdict on VAT', async () => {
      await seedPayment({
        amountSatang: 10_000,
        vatSatang: 700,
        at: `now() - interval '40 days'`,
      });
      await seedPayment({ amountSatang: 20_000, vatSatang: 1_400 });

      const i = income(await getIncome(adminJwt, '?range=30d').expect(200));
      expect(i.changes.vatSatang.direction).toBe('up');
      expect(i.changes.vatSatang.improved).toBeNull();
    });

    it('claims no attendance change where nothing ran before', async () => {
      const past = await seedEventAt('rpt-cmp', 'Compared Summit', '-2 days');
      await seedTicket({ event: past, checkedIn: 'onTime' });

      const a = attendance(
        await getAttendance(adminJwt, '?q=Compared').expect(200),
      );
      expect(a.changes.attendanceRate).toEqual({
        direction: 'flat',
        percent: null,
        improved: null,
      });
    });
  });

  describe('overview (US-RPT-01)', () => {
    it('reports the same revenue as the income report’s net', async () => {
      // The story's own note, proven across two modules and one database rather
      // than asserted about two functions that happen to look alike.
      await seedPayment({
        amountSatang: 107_000,
        vatSatang: 7_000,
        refundSatang: 10_000,
        feeSatang: 3_000,
      });

      const net = income(await getIncome(adminJwt).expect(200)).totals
        .netSatang;
      const view = overview(await getOverview(adminJwt).expect(200));
      expect(view.kpis.revenueSatang?.value).toBe(net);
      expect(view.kpis.revenueSatang?.value).toBe(90_000);
    });

    it('counts registrations as confirmed seats', async () => {
      await seedOrder({ status: 'confirmed', seats: 4 });
      await seedOrder({ status: 'cancelled', seats: 3 });

      const view = overview(await getOverview(adminJwt).expect(200));
      expect(view.kpis.registrations.value).toBe(4);
    });

    it('prices the average ticket over the seats that were paid for', async () => {
      // ฿1,000 across four seats — not across the two payments.
      await seedPayment({ amountSatang: 60_000, seats: 2 });
      await seedPayment({ amountSatang: 40_000, seats: 2 });

      const view = overview(await getOverview(adminJwt).expect(200));
      expect(view.kpis.averageTicketSatang?.value).toBe(25_000);
    });

    it('rates refunds against the money taken', async () => {
      await seedPayment({ amountSatang: 100_000, refundSatang: 4_000 });
      const view = overview(await getOverview(adminJwt).expect(200));
      expect(view.kpis.refundRate?.value).toBe(4);
    });

    it('compares against the period immediately before this one', async () => {
      // 30-day window: the ฿50 forty days ago lands in the previous window, the
      // ฿100 today in this one. Two different queries, two different windows.
      await seedPayment({
        amountSatang: 5_000,
        at: `now() - interval '40 days'`,
      });
      await seedPayment({ amountSatang: 10_000, at: 'now()' });

      const view = overview(
        await getOverview(adminJwt, '?range=30d').expect(200),
      );
      expect(view.kpis.revenueSatang?.value).toBe(10_000);
      expect(view.kpis.revenueSatang?.change).toMatchObject({
        direction: 'up',
        percent: 100,
        improved: true,
      });
    });

    it('reads a falling refund rate as an improvement', async () => {
      // 10% last period, 2% this one. Down in sign, better in meaning.
      await seedPayment({
        amountSatang: 100_000,
        refundSatang: 10_000,
        at: `now() - interval '40 days'`,
      });
      await seedPayment({ amountSatang: 100_000, refundSatang: 2_000 });

      const change = overview(
        await getOverview(adminJwt, '?range=30d').expect(200),
      ).kpis.refundRate?.change;
      expect(change).toMatchObject({ direction: 'down', improved: true });
    });

    describe('the revenue trend', () => {
      it('plots a 30-day window day by day, quiet days included', async () => {
        await seedPayment({ amountSatang: 10_000 });
        const trend = overview(
          await getOverview(adminJwt, '?range=30d').expect(200),
        ).revenue;
        expect(trend?.granularity).toBe('day');
        expect(trend?.points).toHaveLength(30);
      });

      it('plots a year month by month', async () => {
        const trend = overview(
          await getOverview(adminJwt, '?range=year').expect(200),
        ).revenue;
        expect(trend?.granularity).toBe('month');
        expect(trend?.points.length).toBeGreaterThanOrEqual(12);
      });

      it('adds up to the headline total', async () => {
        await seedPayment({ amountSatang: 60_000, vatSatang: 4_000 });
        await seedPayment({ amountSatang: 40_000, refundSatang: 5_000 });

        const trend = overview(
          await getOverview(adminJwt, '?range=30d').expect(200),
        ).revenue;
        const summed = trend!.points.reduce((a, p) => a + p.netSatang, 0);
        expect(summed).toBe(trend?.totalSatang);
        expect(trend?.totalSatang).toBe(91_000);
      });

      it('gives a zero total and a neutral change for a window with no revenue', async () => {
        // TC-RPT-02: ฿0 and "—", never an error and never a percentage off a
        // baseline of nothing.
        const trend = overview(
          await getOverview(adminJwt, '?range=7d').expect(200),
        ).revenue;
        expect(trend?.totalSatang).toBe(0);
        expect(trend?.change.percent).toBeNull();
        expect(trend?.points).toHaveLength(7);
      });
    });

    it('rates attendance over events that have started', async () => {
      const past = await seedEventAt('rpt-ov', 'Overview Past', '-2 days');
      await seedTicket({ event: past, checkedIn: 'onTime' });
      await seedTicket({ event: past, checkedIn: 'onTime' });
      await seedTicket({ event: past, checkedIn: false });

      const view = overview(
        await getOverview(adminJwt, spanningWindow()).expect(200),
      );
      expect(view.kpis.attendanceRate.value).toBeCloseTo(66.7, 1);
    });

    describe('the ticket-type mix (US-RPT-03)', () => {
      it('splits the sign-ups by ticket type, largest first', async () => {
        const past = await seedEventAt('rpt-mix', 'Mix Event', '-2 days');
        await seedTicket({ event: past, checkedIn: false });
        await seedTicket({ event: past, checkedIn: false });

        const mix = overview(
          await getOverview(adminJwt, spanningWindow()).expect(200),
        ).ticketMix;
        expect(mix.length).toBeGreaterThan(0);
        // Every seedTicket makes its own tier, so the shares must still total
        // the whole however they are split.
        const total = mix.reduce((sum, slice) => sum + slice.percent, 0);
        expect(total).toBeCloseTo(100, 0);
      });

      it('gives an empty mix when nothing was sold', async () => {
        const mix = overview(await getOverview(adminJwt).expect(200)).ticketMix;
        expect(mix).toEqual([]);
      });
    });

    it('narrows every tile to one event, not just the chart', async () => {
      await seedPayment({ event: summitId, amountSatang: 30_000 });
      await seedPayment({ event: galaId, amountSatang: 70_000 });

      const all = overview(await getOverview(adminJwt).expect(200));
      const one = overview(
        await getOverview(adminJwt, `?eventId=${galaId}`).expect(200),
      );
      expect(all.kpis.revenueSatang?.value).toBe(100_000);
      expect(one.kpis.revenueSatang?.value).toBe(70_000);
      expect(one.kpis.registrations.value).toBe(1);
    });

    describe('without finance access (US-RPT-12)', () => {
      it('answers, rather than refusing the whole screen', async () => {
        await seedOrder({ status: 'confirmed', seats: 2 });
        const view = overview(await getOverview(staffJwt).expect(200));
        expect(view.kpis.registrations.value).toBe(2);
      });

      it('withholds every money figure rather than zeroing it', async () => {
        await seedPayment({ amountSatang: 100_000 });
        const view = overview(await getOverview(staffJwt).expect(200));
        expect(view.kpis.revenueSatang).toBeNull();
        expect(view.kpis.averageTicketSatang).toBeNull();
        expect(view.kpis.refundRate).toBeNull();
        expect(view.revenue).toBeNull();
      });

      it('refuses an admin user with no registration access either', async () => {
        await getOverview(outsiderJwt).expect(403);
      });
    });

    it('never reports another workspace’s figures', async () => {
      await seedPayment({
        org: otherOrgId,
        event: otherEventId,
        amountSatang: 99_000,
      });
      await seedPayment({ org: orgId, event: summitId, amountSatang: 1_000 });

      const view = overview(await getOverview(adminJwt).expect(200));
      expect(view.kpis.revenueSatang?.value).toBe(1_000);
    });

    it('refuses a backwards window like every other report', async () => {
      await getOverview(adminJwt, '?from=2026-07-07&to=2026-07-01').expect(422);
    });
  });

  interface EventRow {
    eventId: string;
    eventName: string;
    venue: string | null;
    lifecycle: 'upcoming' | 'live' | 'completed' | 'cancelled';
    registrations: number;
    revenueSatang: number | null;
    attendanceRate: number | null;
  }
  interface EventsReport {
    rows: EventRow[];
    matchedEvents: number;
  }

  const getEvents = (jwt: string, query = '') =>
    request(server)
      .get(`/api/v1/reports/events${query}`)
      .set('Authorization', `Bearer ${jwt}`);

  const performance = (res: { body: unknown }) =>
    (res.body as Success<EventsReport>).data;

  describe('event performance (US-RPT-04)', () => {
    /** Every stage of the lifecycle at once, so one call can check them all. */
    async function seedEveryStage() {
      return {
        past: await seedEventAt('rpt-ep-past', 'Already Ran', '-2 days'),
        live: await seedEventAt('rpt-ep-live', 'Running Now', '-1 hour'),
        soon: await seedEventAt('rpt-ep-soon', 'Still To Come', '5 days'),
        off: await seedEventAt('rpt-ep-off', 'Called Off', '3 days', {
          status: 'cancelled',
        }),
      };
    }

    describe('the lifecycle', () => {
      it('works the stage out from the clock, not from events.status', async () => {
        // Every one of these rows is stored `live`; nothing in the API or the
        // worker ever advances that column, so reading it would badge the lot
        // identically.
        await seedEveryStage();
        const rows = performance(
          await getEvents(adminJwt, `${spanningWindow()}&q=`).expect(200),
        ).rows;
        const stageOf = (name: string) =>
          rows.find((r) => r.eventName === name)?.lifecycle;

        expect(stageOf('Already Ran')).toBe('completed');
        expect(stageOf('Running Now')).toBe('live');
        expect(stageOf('Still To Come')).toBe('upcoming');
      });

      it('lets a cancellation beat the clock', async () => {
        // It starts in three days, so the clock would say "upcoming" — but it
        // was called off, and that was written deliberately.
        await seedEveryStage();
        const row = performance(
          await getEvents(adminJwt, `${spanningWindow()}&q=Called`).expect(200),
        ).rows[0];
        expect(row.lifecycle).toBe('cancelled');
      });

      it('treats an event with no end time as running for a day', async () => {
        await seedEventAt('rpt-ep-open', 'Open Ended', '-2 hours', {
          runsFor: '0 seconds',
        });
        await pool.query(
          `UPDATE events SET end_at = NULL WHERE slug = 'rpt-ep-open'`,
        );
        const row = performance(
          await getEvents(adminJwt, `${spanningWindow()}&q=Open+Ended`).expect(
            200,
          ),
        ).rows[0];
        expect(row.lifecycle).toBe('live');
      });

      it('narrows to one stage', async () => {
        await seedEveryStage();
        const report = performance(
          await getEvents(
            adminJwt,
            `${spanningWindow()}&status=upcoming`,
          ).expect(200),
        );
        const names = report.rows.map((r) => r.eventName);
        expect(names).toContain('Still To Come');
        expect(names).not.toContain('Already Ran');
        expect(names).not.toContain('Called Off');
        // Asserted as a rule rather than a row count: the workspace's two
        // fixture events are upcoming too, and counting them in would make this
        // test about the fixtures instead of about the filter.
        expect(report.rows.every((r) => r.lifecycle === 'upcoming')).toBe(true);
        expect(report.matchedEvents).toBe(report.rows.length);
      });
    });

    describe('the ranking', () => {
      it('lists an event nobody signed up for, last rather than not at all', async () => {
        // The reason this report is driven from `events`: every other per-event
        // report starts at a fact table and cannot see one.
        const busy = await seedEventAt('rpt-ep-busy', 'Busy One', '-2 days');
        await seedEventAt('rpt-ep-quiet', 'Quiet One', '-2 days');
        await seedOrder({ event: busy, seats: 5 });

        const rows = performance(
          await getEvents(adminJwt, spanningWindow()).expect(200),
        ).rows;
        // The workspace holds other events too; what matters is that the one
        // with sign-ups leads and the one without is still present.
        expect(rows[0].eventName).toBe('Busy One');
        expect(rows[0].registrations).toBe(5);
        const quiet = rows.find((r) => r.eventName === 'Quiet One');
        expect(quiet?.registrations).toBe(0);
      });

      it('counts registrations as confirmed seats', async () => {
        const one = await seedEventAt(
          'rpt-ep-seats',
          'Seat Counter',
          '-2 days',
        );
        await seedOrder({ event: one, seats: 4, status: 'confirmed' });
        await seedOrder({ event: one, seats: 3, status: 'cancelled' });

        const row = performance(
          await getEvents(adminJwt, `${spanningWindow()}&q=Seat`).expect(200),
        ).rows[0];
        expect(row.registrations).toBe(4);
      });

      it('leaves drafts out — an unpublished event has no performance', async () => {
        await seedEventAt('rpt-ep-draft', 'Never Published', '-2 days', {
          status: 'draft',
        });
        const report = performance(
          await getEvents(adminJwt, spanningWindow()).expect(200),
        );
        expect(report.rows.map((r) => r.eventName)).not.toContain(
          'Never Published',
        );
      });
    });

    describe('what each row carries', () => {
      it('attaches the event’s takings, all time rather than re-windowed', async () => {
        // The tickets sold long before the event runs; windowing the money on
        // `paid_at` again would report it as having earned nothing.
        const one = await seedEventAt('rpt-ep-rev', 'Earner', '-2 days');
        await seedPayment({
          event: one,
          amountSatang: 107_000,
          vatSatang: 7_000,
          refundSatang: 10_000,
          at: `now() - interval '200 days'`,
        });

        const row = performance(
          await getEvents(adminJwt, `${spanningWindow()}&q=Earner`).expect(200),
        ).rows[0];
        expect(row.revenueSatang).toBe(90_000);
      });

      it('reports ฿0 for an event that has taken nothing', async () => {
        await seedEventAt('rpt-ep-free', 'Free Event', '-2 days');
        const row = performance(
          await getEvents(adminJwt, `${spanningWindow()}&q=Free`).expect(200),
        ).rows[0];
        expect(row.revenueSatang).toBe(0);
      });

      it('rates attendance over the tickets issued', async () => {
        const one = await seedEventAt('rpt-ep-att', 'Door Count', '-2 days');
        await seedTicket({ event: one, checkedIn: 'onTime' });
        await seedTicket({ event: one, checkedIn: 'onTime' });
        await seedTicket({ event: one, checkedIn: false });

        const row = performance(
          await getEvents(adminJwt, `${spanningWindow()}&q=Door`).expect(200),
        ).rows[0];
        expect(row.attendanceRate).toBe(67);
      });

      it('reports no attendance for an event that has not happened', async () => {
        const soon = await seedEventAt('rpt-ep-nya', 'Not Yet Run', '5 days');
        await seedTicket({ event: soon, checkedIn: false });

        const row = performance(
          await getEvents(adminJwt, `${spanningWindow()}&q=Not+Yet`).expect(
            200,
          ),
        ).rows[0];
        expect(row.attendanceRate).toBeNull();
      });

      it('says Online where an event has no venue', async () => {
        await seedEventAt('rpt-ep-web', 'Webinar', '-2 days', { venue: null });
        await pool.query(
          `UPDATE events SET is_online = true WHERE slug = 'rpt-ep-web'`,
        );
        const row = performance(
          await getEvents(adminJwt, `${spanningWindow()}&q=Webinar`).expect(
            200,
          ),
        ).rows[0];
        expect(row.venue).toBe('Online');
      });
    });

    interface DiscountRow {
      code: string;
      standing: 'active' | 'scheduled' | 'expired' | 'disabled';
      terms: string | null;
      fixedValueSatang: number | null;
      scope: string;
      redemptions: number;
      discountSatang: number;
      influencedSatang: number;
      returnRatio: number | null;
    }
    interface DiscountsReport {
      rows: DiscountRow[];
      matchedCodes: number;
      totals: {
        activeCodes: number;
        redemptions: number;
        discountSatang: number;
        influencedSatang: number;
        returnRatio: number | null;
      };
    }

    const getDiscounts = (jwt: string, query = '') =>
      request(server)
        .get(`/api/v1/reports/discounts${query}`)
        .set('Authorization', `Bearer ${jwt}`);

    const payback = (res: { body: unknown }) =>
      (res.body as Success<DiscountsReport>).data;

    interface LedgerRow {
      id: string;
      kind: 'payment' | 'refund';
      reference: string;
      personName: string;
      method: string;
      amountSatang: number;
      outcome: 'succeeded' | 'pending' | 'refunded' | 'failed';
      paymentId: string;
    }
    interface LedgerReport {
      rows: LedgerRow[];
      matchedEntries: number;
      totals: {
        entries: number;
        payments: number;
        failed: number;
        refunds: number;
        collectedSatang: number;
        refundedSatang: number;
        successRate: number | null;
      };
    }

    const getLedger = (jwt: string, query = '') =>
      request(server)
        .get(`/api/v1/reports/transactions${query}`)
        .set('Authorization', `Bearer ${jwt}`);

    const ledger = (res: { body: unknown }) =>
      (res.body as Success<LedgerReport>).data;

    describe('transaction ledger (US-RPT-06)', () => {
      it('lists a refund as its own row, beside the payment it reverses', async () => {
        // The story by name: the refund is a new entry and the original amount
        // is never rewritten.
        await seedPayment({ amountSatang: 125_000, refundSatang: 125_000 });

        const rows = ledger(await getLedger(adminJwt).expect(200)).rows;
        const payment = rows.find((r) => r.kind === 'payment')!;
        const refund = rows.find((r) => r.kind === 'refund')!;

        expect(payment.amountSatang).toBe(125_000);
        // Positive on the wire; the minus sign is the screen's job.
        expect(refund.amountSatang).toBe(125_000);
        expect(refund.paymentId).toBe(payment.paymentId);
      });

      it('derives a readable reference for a refund from its parent', async () => {
        await seedPayment({ amountSatang: 50_000, refundSatang: 20_000 });

        const rows = ledger(await getLedger(adminJwt).expect(200)).rows;
        const payment = rows.find((r) => r.kind === 'payment')!;
        const refund = rows.find((r) => r.kind === 'refund')!;
        expect(refund.reference).toBe(`${payment.reference}-R1`);
      });

      it('numbers a second refund on the same payment', async () => {
        await seedPayment({ amountSatang: 60_000, refundSatang: 20_000 });
        await pool.query(
          `INSERT INTO refunds (organization_id, payment_id, order_id, amount_satang, status,
                              issued_by, idempotency_key, issued_at)
         SELECT organization_id, id, order_id, 10000, 'succeeded',
                (SELECT id FROM users WHERE organization_id = $1 LIMIT 1),
                'ref-led-second', now() + interval '1 minute'
         FROM payments WHERE organization_id = $1 LIMIT 1`,
          [orgId],
        );

        const refs = ledger(await getLedger(adminJwt).expect(200))
          .rows.filter((r) => r.kind === 'refund')
          .map((r) => r.reference)
          .sort();
        expect(refs.some((r) => r.endsWith('-R1'))).toBe(true);
        expect(refs.some((r) => r.endsWith('-R2'))).toBe(true);
      });

      it('marks a failed charge and keeps its money out of the takings', async () => {
        await seedPayment({ amountSatang: 90_000, status: 'failed' });
        await seedPayment({ amountSatang: 10_000 });

        const t = ledger(await getLedger(adminJwt).expect(200)).totals;
        expect(t.failed).toBe(1);
        expect(t.payments).toBe(1);
        // The failure is in the rate's denominator but not in the money.
        expect(t.collectedSatang).toBe(10_000);
        expect(t.successRate).toBe(50);
      });

      it('reports no success rate for a window holding only refunds', async () => {
        // Nothing was attempted, so there is no rate — 0% would read as
        // "everything failed".
        const t = ledger(await getLedger(adminJwt).expect(200)).totals;
        expect(t.entries).toBe(0);
        expect(t.successRate).toBeNull();
      });

      it('names the method the schema knows, never a card brand', async () => {
        // PCI SAQ-A: no brand is stored and none is coming.
        await seedPayment({ amountSatang: 10_000 });
        const row = ledger(await getLedger(adminJwt).expect(200)).rows[0];
        expect(row.method).toBe('Card');
      });

      it('searches on the payer and on the reference', async () => {
        await seedPayment({ amountSatang: 10_000, payer: 'Ploy Srisai' });
        await seedPayment({ amountSatang: 20_000, payer: 'Somchai Wong' });

        const byName = ledger(await getLedger(adminJwt, '?q=Ploy').expect(200));
        expect(byName.rows).toHaveLength(1);
        expect(byName.rows[0].personName).toBe('Ploy Srisai');

        const reference = byName.rows[0].reference;
        const byRef = ledger(
          await getLedger(adminJwt, `?q=${reference}`).expect(200),
        );
        expect(byRef.rows).toHaveLength(1);
      });

      it('pages the entries while the tiles stay whole', async () => {
        await seedPayment({ amountSatang: 10_000 });
        await seedPayment({ amountSatang: 20_000 });

        const page = ledger(
          await getLedger(adminJwt, '?page=1&limit=1').expect(200),
        );
        expect(page.rows).toHaveLength(1);
        expect(page.totals.entries).toBe(2);
        expect(page.matchedEntries).toBe(2);
      });

      it('is finance-only: registration access is not enough', async () => {
        await getLedger(staffJwt).expect(403);
        await getLedger(adminJwt).expect(200);
      });

      it('never shows another workspace’s transactions', async () => {
        await seedPayment({
          org: otherOrgId,
          event: otherEventId,
          amountSatang: 99_000,
        });
        await seedPayment({ org: orgId, amountSatang: 1_000 });

        const rows = ledger(await getLedger(adminJwt).expect(200)).rows;
        expect(rows).toHaveLength(1);
        expect(rows[0].amountSatang).toBe(1_000);
      });
    });

    describe('discount payback (US-RPT-10)', () => {
      /** A code, with whatever terms and validity the case needs. */
      async function seedCode(o: {
        code: string;
        type?: 'percent' | 'fixed';
        value?: number;
        event?: string | null;
        validFrom?: string;
        validUntil?: string;
        status?: string;
      }): Promise<string> {
        const res = await pool.query<{ id: string }>(
          `INSERT INTO discount_codes (organization_id, event_id, code, type, value, status,
                                     valid_from, valid_until)
         VALUES ($1,$2,$3,$4::discount_type,$5,$6::discount_status,
                 ${o.validFrom ?? 'NULL'}, ${o.validUntil ?? 'NULL'})
         RETURNING id`,
          [
            orgId,
            o.event === undefined ? summitId : o.event,
            o.code,
            o.type ?? 'percent',
            o.value ?? 25,
            o.status ?? 'active',
          ],
        );
        temporaryCodes.push(res.rows[0].id);
        return res.rows[0].id;
      }

      /** A redemption of `code` on a fresh order of `totalSatang`. */
      async function seedRedemption(o: {
        code: string;
        amountSatang: number;
        totalSatang: number;
        event?: string;
        orderStatus?: string;
      }): Promise<void> {
        seq += 1;
        const order = await pool.query<{ id: string }>(
          `INSERT INTO orders (organization_id, reference, event_id, buyer_name, buyer_email,
                             status, payment_status, seats, subtotal_satang,
                             vat_amount_satang, total_satang, discount_amount_satang)
         VALUES ($1,$2,$3,'Anan','anan@rpt.test',$4,'paid',1,$5,0,$5,$6)
         RETURNING id`,
          [
            orgId,
            `ORD-DSC-${seq}`,
            o.event ?? summitId,
            o.orderStatus ?? 'confirmed',
            o.totalSatang,
            o.amountSatang,
          ],
        );
        await pool.query(
          `INSERT INTO discount_redemptions (organization_id, discount_code_id, order_id,
                                           buyer_email, amount_satang)
         VALUES ($1,$2,$3,'anan@rpt.test',$4)`,
          [orgId, o.code, order.rows[0].id, o.amountSatang],
        );
      }

      describe('a code’s payback', () => {
        it('counts redemptions, what was given away, and what it drove', async () => {
          const code = await seedCode({ code: 'EARLYBIRD' });
          await seedRedemption({
            code,
            amountSatang: 20_000,
            totalSatang: 80_000,
          });
          await seedRedemption({
            code,
            amountSatang: 20_000,
            totalSatang: 80_000,
          });

          const row = payback(
            await getDiscounts(adminJwt, '?q=EARLY').expect(200),
          ).rows[0];
          expect(row.redemptions).toBe(2);
          expect(row.discountSatang).toBe(40_000);
          expect(row.influencedSatang).toBe(160_000);
          // Four Baht of orders for every Baht let off.
          expect(row.returnRatio).toBe(4);
        });

        it('ignores a redemption on an order that was never confirmed', async () => {
          // An abandoned checkout is not payback, and counting it would credit
          // the promotion with a sale that never happened.
          const code = await seedCode({ code: 'ABANDONED' });
          await seedRedemption({
            code,
            amountSatang: 20_000,
            totalSatang: 80_000,
            orderStatus: 'pending',
          });

          const row = payback(
            await getDiscounts(adminJwt, '?q=ABANDON').expect(200),
          ).rows[0];
          expect(row.redemptions).toBe(0);
          expect(row.influencedSatang).toBe(0);
        });

        it('lists a code nobody has used, reading zero', async () => {
          // The story by name: a scheduled code reads zero rather than vanishing.
          // Needs a forward-looking window — the named ranges all end today, so
          // a campaign that starts next week is outside them by definition, the
          // same way an unstarted event is outside the attendance report.
          await seedCode({
            code: 'AUTUMN15',
            validFrom: `now() + interval '10 days'`,
          });

          const row = payback(
            await getDiscounts(adminJwt, `${spanningWindow()}&q=AUTUMN`).expect(
              200,
            ),
          ).rows[0];
          expect(row.standing).toBe('scheduled');
          expect(row.redemptions).toBe(0);
          // No ratio, rather than a zero that would read as "paid back nothing".
          expect(row.returnRatio).toBeNull();
        });

        it('leaves out a campaign that starts beyond the window', async () => {
          // The flip side of the case above, asserted so the window is doing
          // the work rather than the test happening to pass.
          await seedCode({
            code: 'NEXTYEAR',
            validFrom: `now() + interval '90 days'`,
          });
          const report = payback(
            await getDiscounts(adminJwt, '?range=30d').expect(200),
          );
          expect(report.rows.map((r) => r.code)).not.toContain('NEXTYEAR');
        });

        it('describes a percentage code by its percentage', async () => {
          await seedCode({ code: 'QUARTER', type: 'percent', value: 25 });
          const row = payback(
            await getDiscounts(adminJwt, '?q=QUARTER').expect(200),
          ).rows[0];
          expect(row.terms).toBe('25% off');
          expect(row.fixedValueSatang).toBeNull();
        });

        it('leaves a fixed code’s amount as satang for the edge to format', async () => {
          await seedCode({ code: 'FLAT200', type: 'fixed', value: 20_000 });
          const row = payback(
            await getDiscounts(adminJwt, '?q=FLAT').expect(200),
          ).rows[0];
          expect(row.fixedValueSatang).toBe(20_000);
          expect(row.terms).toBeNull();
        });

        it('says which event a code is scoped to, or all of them', async () => {
          await seedCode({ code: 'SCOPED' });
          await seedCode({ code: 'GLOBAL', event: null });

          const rows = payback(await getDiscounts(adminJwt).expect(200)).rows;
          expect(rows.find((r) => r.code === 'SCOPED')?.scope).toBe(
            'Tech Summit 2026',
          );
          expect(rows.find((r) => r.code === 'GLOBAL')?.scope).toBe(
            'All events',
          );
        });
      });

      describe('the standing', () => {
        it('works it out from the dates, not from the stored status', async () => {
          // `status` is only settled as a side effect of listing codes on another
          // screen; a report must not depend on somebody having visited one.
          await seedCode({
            code: 'STALE',
            status: 'active',
            validUntil: `now() - interval '2 days'`,
          });
          const row = payback(
            await getDiscounts(adminJwt, '?q=STALE').expect(200),
          ).rows[0];
          expect(row.standing).toBe('expired');
        });

        it('lets a deliberate disable beat the dates', async () => {
          await seedCode({ code: 'SWITCHEDOFF', status: 'disabled' });
          const row = payback(
            await getDiscounts(adminJwt, '?q=SWITCHED').expect(200),
          ).rows[0];
          expect(row.standing).toBe('disabled');
        });
      });

      describe('the tiles', () => {
        it('counts active codes without counting the scheduled ones', async () => {
          await seedCode({ code: 'LIVEONE' });
          await seedCode({
            code: 'LATERONE',
            validFrom: `now() + interval '10 days'`,
          });

          const totals = payback(
            await getDiscounts(adminJwt).expect(200),
          ).totals;
          expect(totals.activeCodes).toBe(1);
        });

        it('sums the payback over the whole filter', async () => {
          const one = await seedCode({ code: 'SUMONE' });
          const two = await seedCode({ code: 'SUMTWO' });
          await seedRedemption({
            code: one,
            amountSatang: 10_000,
            totalSatang: 50_000,
          });
          await seedRedemption({
            code: two,
            amountSatang: 10_000,
            totalSatang: 30_000,
          });

          const totals = payback(
            await getDiscounts(adminJwt).expect(200),
          ).totals;
          expect(totals.redemptions).toBe(2);
          expect(totals.discountSatang).toBe(20_000);
          expect(totals.influencedSatang).toBe(80_000);
          expect(totals.returnRatio).toBe(4);
        });

        it('answers a filter matching nothing with zeros, not an error', async () => {
          const report = payback(
            await getDiscounts(adminJwt, '?q=no-such-code').expect(200),
          );
          expect(report.rows).toEqual([]);
          expect(report.totals.returnRatio).toBeNull();
        });
      });

      describe('exporting a report (US-RPT-11)', () => {
        const download = (jwt: string, path: string, query = '') =>
          request(server)
            .get(`/api/v1/reports/${path}${query}`)
            .set('Authorization', `Bearer ${jwt}`);

        it('sends a file rather than the API envelope', async () => {
          await seedOrder({ seats: 3 });
          const res = await download(adminJwt, 'registrations.csv').expect(200);

          expect(res.headers['content-type']).toContain('csv');
          expect(res.headers['content-disposition']).toContain(
            'registrations.csv',
          );
          // A file, not `{ success, data }`.
          expect(res.text).not.toContain('"success"');
          expect(res.text.split('\n')[0]).toContain('Event');
        });

        it('opens with a byte-order mark so Thai reads in a spreadsheet', async () => {
          await seedOrder({});
          const res = await download(adminJwt, 'registrations.csv').expect(200);
          expect(res.text.charCodeAt(0)).toBe(0xfeff);
        });

        it('holds exactly the rows the filter matched', async () => {
          await seedOrder({ event: summitId, seats: 2 });
          await seedOrder({ event: galaId, seats: 5 });

          const all = await download(adminJwt, 'registrations.csv').expect(200);
          const one = await download(
            adminJwt,
            'registrations.csv',
            `?eventId=${galaId}`,
          ).expect(200);

          // Header plus one row per event, and a trailing newline.
          expect(all.text.trim().split('\n')).toHaveLength(3);
          expect(one.text.trim().split('\n')).toHaveLength(2);
          expect(one.text).toContain('Charity Gala');
          expect(one.text).not.toContain('Tech Summit');
        });

        it('ignores paging — an export is the whole set', async () => {
          await seedOrder({ event: summitId });
          await seedOrder({ event: galaId });

          const res = await download(
            adminJwt,
            'registrations.csv',
            '?page=1&limit=1',
          ).expect(200);
          expect(res.text.trim().split('\n')).toHaveLength(3);
        });

        it('writes money as a number a spreadsheet can add up', async () => {
          await seedPayment({ amountSatang: 107_000, vatSatang: 7_000 });
          const res = await download(adminJwt, 'income.csv').expect(200);
          expect(res.text).toContain('1070.00');
        });

        it('keeps each export behind the same gate as its report', async () => {
          // Finance files stay finance-only (US-RPT-12).
          await download(staffJwt, 'income.csv').expect(403);
          await download(staffJwt, 'transactions.csv').expect(403);
          await download(staffJwt, 'discounts.csv').expect(403);
          // The staff-visible ones still answer.
          await download(staffJwt, 'registrations.csv').expect(200);
          await download(staffJwt, 'attendance.csv').expect(200);
          await download(staffJwt, 'events.csv').expect(200);
        });

        it('refuses a backwards window, like the report it mirrors', async () => {
          await download(
            adminJwt,
            'registrations.csv',
            '?from=2026-07-07&to=2026-07-01',
          ).expect(422);
        });
      });

      describe('who may read it (US-RPT-12)', () => {
        it('is finance-only: registration access is not enough', async () => {
          await getDiscounts(staffJwt).expect(403);
          await getDiscounts(adminJwt).expect(200);
        });
      });
    });

    describe('who may read it (US-RPT-12)', () => {
      it('gives staff the ranking with the money withheld, not a 403', async () => {
        const one = await seedEventAt('rpt-ep-staff', 'Staff View', '-2 days');
        await seedOrder({ event: one, seats: 2 });
        await seedPayment({ event: one, amountSatang: 50_000 });

        const row = performance(
          await getEvents(staffJwt, `${spanningWindow()}&q=Staff`).expect(200),
        ).rows[0];
        // Three seats, not two: `seedPayment` brings its own confirmed order.
        expect(row.registrations).toBe(3);
        // Null, never 0 — "you may not see this" is not "it earned nothing".
        expect(row.revenueSatang).toBeNull();
      });

      it('refuses an admin user without registration access', async () => {
        await getEvents(outsiderJwt).expect(403);
      });

      it('never ranks another workspace’s events', async () => {
        const rows = performance(
          await getEvents(adminJwt, spanningWindow()).expect(200),
        ).rows;
        expect(rows.map((r) => r.eventId)).not.toContain(otherEventId);
      });
    });
  });

  describe('who may read it (US-RPT-12)', () => {
    it('lets a staff member with registration access read it', async () => {
      await seedOrder({});
      const res = await get(staffJwt).expect(200);
      expect(report(res).totals.total).toBe(1);
    });

    it('refuses an admin user without registration access', async () => {
      await get(outsiderJwt).expect(403);
    });

    it('refuses an unauthenticated caller', async () => {
      await request(server).get('/api/v1/reports/registrations').expect(401);
    });

    it('never reports another workspace’s registrations', async () => {
      await seedOrder({ org: otherOrgId, event: otherEventId, seats: 6 });
      await seedOrder({ org: orgId, event: summitId, seats: 1 });

      const mine = report(await get(adminJwt).expect(200));
      expect(mine.totals.total).toBe(1);
      expect(mine.rows.map((r) => r.eventId)).not.toContain(otherEventId);

      const theirs = report(await get(otherJwt).expect(200));
      expect(theirs.totals.total).toBe(6);
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
    'discount_redemptions',
    'discount_codes',
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
