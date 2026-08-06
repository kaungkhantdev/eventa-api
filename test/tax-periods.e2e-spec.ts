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
const ORG = { slug: 'vat-e2e', name: 'VAT E2E' };
const ADMIN = 'admin@vat-e2e.test';
const ORGANIZER = 'organizer@vat-e2e.test';
/** ฿3,223,696 gross → ฿3,012,800 taxable + ฿210,896 VAT (the story's example). */
const JUNE_GROSS = 322_369_600;
const JUNE_SALES = 301_280_000;
const JUNE_VAT = 21_089_600;
/** A year safely in the past, so every month of it is Due. */
const YEAR = 2024;

interface Success<T> {
  data: T;
}
interface Period {
  year: number;
  month: number;
  period: string;
  dueAt: string;
  salesSatang: number;
  vatSatang: number;
  whtSatang: number;
  remittedSatang: number;
  status: string;
  filedAt: string | null;
  late: boolean;
  canFile: boolean;
}
interface Headlines {
  vatCollectedSatang: number;
  vatRemittedSatang: number;
  vatPayableSatang: number;
  withholdingSatang: number;
}
interface Ledger {
  periods: Period[];
  headlines: Headlines;
}

describe('The VAT ledger (e2e — US-FIN-11/12)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let orgId: number;
  let eventId: string;
  let orderId: string;
  let adminJwt: string;
  let organizerJwt: string;
  let seq = 0;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    orgId = await seedOrg(pool);
    eventId = await seedEvent(pool, orgId);
    orderId = await seedOrder(pool, orgId, eventId);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();
    server = app.getHttpServer() as Server;

    adminJwt = await token(ADMIN);
    organizerJwt = await token(ORGANIZER);
  }, 30000);

  afterEach(async () => {
    await pool.query(`DELETE FROM refunds WHERE organization_id = $1`, [orgId]);
    await pool.query(`DELETE FROM payments WHERE organization_id = $1`, [
      orgId,
    ]);
    await pool.query(`DELETE FROM tax_periods WHERE organization_id = $1`, [
      orgId,
    ]);
  });

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  async function token(email: string): Promise<string> {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, orgSlug: ORG.slug, persona: 'admin' });
    return (res.body as Success<{ accessToken: string }>).data.accessToken;
  }

  /** A settled payment, dated by when the money landed in Bangkok time. */
  async function seedPayment(paidAt: string, amount = JUNE_GROSS) {
    seq += 1;
    const res = await pool.query<{ id: string }>(
      `INSERT INTO payments (organization_id, txn, order_id, event_id, payer_name,
                             method, amount_satang, status, paid_at, idempotency_key)
       VALUES ($1,$2,$3,$4,'Anan','Card',$5,'paid',$6,$7) RETURNING id`,
      [
        orgId,
        `TXN-VAT-${seq}`,
        orderId,
        eventId,
        amount,
        paidAt,
        `idem-${seq}`,
      ],
    );
    return res.rows[0].id;
  }

  async function seedRefund(
    paymentId: string,
    issuedAt: string,
    amount: number,
  ) {
    seq += 1;
    const admin = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1`,
      [ADMIN],
    );
    await pool.query(
      `INSERT INTO refunds (organization_id, payment_id, order_id, amount_satang,
                            status, issued_by, issued_at, idempotency_key)
       VALUES ($1,$2,$3,$4,'succeeded',$5,$6,$7)`,
      [
        orgId,
        paymentId,
        orderId,
        amount,
        admin.rows[0].id,
        issuedAt,
        `ridem-${seq}`,
      ],
    );
  }

  const ledger = (jwt: string, query: string) =>
    request(server)
      .get(`/api/v1/tax-periods?${query}`)
      .set('Authorization', `Bearer ${jwt}`);

  const file = (jwt: string, month: number, body: object = {}) =>
    request(server)
      .post(`/api/v1/tax-periods/${YEAR}/${month}/file`)
      .set('Authorization', `Bearer ${jwt}`)
      .send(body);

  const june = async (jwt = adminJwt): Promise<Period> => {
    const res = await ledger(jwt, `year=${YEAR}`);
    return (res.body as Success<Ledger>).data.periods[5];
  };

  describe('the monthly ledger (US-FIN-11)', () => {
    it('charges 7% VAT on the month’s taxable sales', async () => {
      await seedPayment(`${YEAR}-06-15T03:00:00Z`);
      const row = await june();
      expect(row.period).toBe('Jun');
      expect(row.salesSatang).toBe(JUNE_SALES);
      expect(row.vatSatang).toBe(JUNE_VAT);
      expect(Math.round(row.salesSatang * 0.07)).toBe(row.vatSatang);
    });

    it('dates every period on the 15th of the following month', async () => {
      const res = await ledger(adminJwt, `year=${YEAR}`);
      const { periods } = (res.body as Success<Ledger>).data;
      expect(periods).toHaveLength(12);
      expect(periods[5].dueAt).toBe(`${YEAR}-07-15`);
      expect(periods[11].dueAt).toBe(`${YEAR + 1}-01-15`);
    });

    it('assigns takings to the Bangkok month, not the UTC one', async () => {
      // 30 Jun 18:00 UTC is already 1 Jul in Bangkok — July's return, not June's.
      await seedPayment(`${YEAR}-06-30T18:00:00Z`);
      const res = await ledger(adminJwt, `year=${YEAR}`);
      const { periods } = (res.body as Success<Ledger>).data;
      expect(periods[5].vatSatang).toBe(0);
      expect(periods[6].vatSatang).toBe(JUNE_VAT);
    });

    it('nets a refund out of the month the money went BACK, not the month it was sold', async () => {
      const paymentId = await seedPayment(`${YEAR}-06-15T03:00:00Z`);
      await seedRefund(paymentId, `${YEAR}-07-10T03:00:00Z`, JUNE_GROSS);
      const res = await ledger(adminJwt, `year=${YEAR}`);
      const { periods } = (res.body as Success<Ledger>).data;
      // June keeps the sale it reported…
      expect(periods[5].vatSatang).toBe(JUNE_VAT);
      // …and July carries the reversal.
      expect(periods[6].vatSatang).toBe(-JUNE_VAT);
    });

    it('keeps VAT payable equal to collected minus remitted', async () => {
      await seedPayment(`${YEAR}-06-15T03:00:00Z`);
      const res = await ledger(adminJwt, `year=${YEAR}`);
      const { headlines } = (res.body as Success<Ledger>).data;
      expect(headlines.vatCollectedSatang).toBe(JUNE_VAT);
      expect(headlines.vatRemittedSatang).toBe(0);
      expect(headlines.vatPayableSatang).toBe(JUNE_VAT);
    });

    it('narrows to a filing status while the headline still covers the year', async () => {
      await seedPayment(`${YEAR}-06-15T03:00:00Z`);
      await file(adminJwt, 6);
      const res = await ledger(adminJwt, `year=${YEAR}&status=filed`);
      const { periods, headlines } = (res.body as Success<Ledger>).data;
      expect(periods).toHaveLength(1);
      expect(periods[0].period).toBe('Jun');
      expect(headlines.vatCollectedSatang).toBe(JUNE_VAT);
    });

    it('refuses a nonsense year outright', async () => {
      // A malformed query is a 400 (the DTO pipe); a rule the domain refuses is
      // a 422 — see the month check below.
      expect((await ledger(adminJwt, 'year=99')).status).toBe(400);
      expect((await ledger(adminJwt, 'year=nope')).status).toBe(400);
    });
  });

  describe('recording the filing (US-FIN-12)', () => {
    it('freezes the period, remits its VAT, and drops payable by that much', async () => {
      await seedPayment(`${YEAR}-06-15T03:00:00Z`);
      const res = await file(adminJwt, 6);
      expect(res.status).toBe(200);
      const filed = (res.body as Success<Period>).data;
      expect(filed.status).toBe('filed');
      expect(filed.remittedSatang).toBe(JUNE_VAT);

      const after = (
        (await ledger(adminJwt, `year=${YEAR}`)).body as Success<Ledger>
      ).data;
      expect(after.headlines.vatRemittedSatang).toBe(JUNE_VAT);
      expect(after.headlines.vatPayableSatang).toBe(0);
    });

    it('a refund landing after the filing leaves the filed return untouched', async () => {
      const paymentId = await seedPayment(`${YEAR}-06-15T03:00:00Z`);
      await file(adminJwt, 6);
      await seedRefund(paymentId, `${YEAR}-07-10T03:00:00Z`, JUNE_GROSS);
      const after = (
        (await ledger(adminJwt, `year=${YEAR}`)).body as Success<Ledger>
      ).data;
      // June still reports exactly what was filed…
      expect(after.periods[5].vatSatang).toBe(JUNE_VAT);
      expect(after.periods[5].remittedSatang).toBe(JUNE_VAT);
      // …and the adjustment carries into July, the next open period.
      expect(after.periods[6].vatSatang).toBe(-JUNE_VAT);
    });

    it('flags a filing made after the deadline as late', async () => {
      await seedPayment(`${YEAR}-06-15T03:00:00Z`);
      const filed = (await file(adminJwt, 6)).body as Success<Period>;
      // YEAR is in the past, so this filing is years beyond its 15 Jul deadline.
      expect(filed.data.late).toBe(true);
    });

    it('records the withholding figure alongside the return', async () => {
      await seedPayment(`${YEAR}-06-15T03:00:00Z`);
      const filed = (await file(adminJwt, 6, { whtSatang: 300_000 }))
        .body as Success<Period>;
      expect(filed.data.whtSatang).toBe(300_000);
      const after = (
        (await ledger(adminJwt, `year=${YEAR}`)).body as Success<Ledger>
      ).data;
      expect(after.headlines.withholdingSatang).toBe(300_000);
      // Withholding is tracked separately — it does not move VAT payable.
      expect(after.headlines.vatPayableSatang).toBe(0);
    });

    it('refuses a period that has not ended yet', async () => {
      const thisYear = new Date().getUTCFullYear();
      const res = await request(server)
        .post(`/api/v1/tax-periods/${thisYear + 1}/6/file`)
        .set('Authorization', `Bearer ${adminJwt}`)
        .send({});
      expect(res.status).toBe(409);
      expect((res.body as { message: string }).message).toMatch(
        /still running/i,
      );
    });

    it('refuses a period that is already filed', async () => {
      await seedPayment(`${YEAR}-06-15T03:00:00Z`);
      expect((await file(adminJwt, 6)).status).toBe(200);
      const again = await file(adminJwt, 6);
      expect(again.status).toBe(409);
      expect((again.body as { message: string }).message).toMatch(/already/i);
    });

    it('refuses a month outside the calendar', async () => {
      expect((await file(adminJwt, 13)).status).toBe(422);
    });

    it('never files the same return twice under a double-submit', async () => {
      await seedPayment(`${YEAR}-06-15T03:00:00Z`);
      await Promise.all([file(adminJwt, 6), file(adminJwt, 6)]);
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*) FROM tax_periods WHERE organization_id = $1`,
        [orgId],
      );
      expect(Number(rows[0].count)).toBe(1);
    });
  });

  describe('who may do what (US-FIN-14)', () => {
    it('lets an Organizer read the ledger', async () => {
      expect((await ledger(organizerJwt, `year=${YEAR}`)).status).toBe(200);
    });

    it('denies an Organizer the filing', async () => {
      await seedPayment(`${YEAR}-06-15T03:00:00Z`);
      expect((await file(organizerJwt, 6)).status).toBe(403);
      const row = await june();
      expect(row.status).toBe('due');
    });

    it('refuses an unauthenticated caller outright', async () => {
      const res = await request(server).get(`/api/v1/tax-periods?year=${YEAR}`);
      expect(res.status).toBe(401);
    });
  });
});

const PERM_GROUP: Record<string, string> = {
  finView: 'Finance',
  finManage: 'Finance',
};

async function seedOrg(pool: Pool): Promise<number> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug, vat_rate) VALUES ($1, $2, 0.0700) RETURNING id`,
    [ORG.name, ORG.slug],
  );
  const orgId = Number(res.rows[0].id);
  const passwordHash = await hash(PASSWORD);
  const people = [
    { email: ADMIN, roleName: 'Admin', grants: ['finView', 'finManage'] },
    { email: ORGANIZER, roleName: 'Organizer', grants: ['finView'] },
  ];
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
       VALUES ($1, 'Seed', $2, 'admin', 'Active', $3) RETURNING id`,
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

async function seedEvent(pool: Pool, orgId: number): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO events (organization_id, slug, name, type, bucket, status, visibility,
                         start_at, timezone, organizer_name, venue_name, city, published_at)
     VALUES ($1,'vat-summit','VAT Summit','Conference','active','upcoming','public',
             now() + interval '30 days','Asia/Bangkok','Acme','QSNCC','Bangkok', now())
     RETURNING id`,
    [orgId],
  );
  return res.rows[0].id;
}

async function seedOrder(
  pool: Pool,
  orgId: number,
  eventId: string,
): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO orders (organization_id, reference, event_id, buyer_name, buyer_email,
                         status, payment_status, seats, subtotal_satang, vat_amount_satang,
                         total_satang)
     VALUES ($1,'ORD-VAT-1',$2,'Anan','anan@vat.test','confirmed','paid',2,$3,$4,$3)
     RETURNING id`,
    [orgId, eventId, JUNE_GROSS, JUNE_VAT],
  );
  return res.rows[0].id;
}

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM audit_events WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug = $1)`,
    [ORG.slug],
  );
  await pool.query(`DELETE FROM organizations WHERE slug = $1`, [ORG.slug]);
}
