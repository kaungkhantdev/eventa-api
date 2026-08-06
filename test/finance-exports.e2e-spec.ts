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
const ORG = { slug: 'fx-e2e', name: 'Finance Exports E2E' };
const ADMIN = 'admin@fx-e2e.test';
const ORGANIZER = 'organizer@fx-e2e.test';
const STAFF = 'staff@fx-e2e.test';
/** A Thai name is the point of the BOM assertion. */
const THAI_BUYER = 'อนันต์ สุขสวัสดิ์';
const BAHT = 100;
const TOTAL = 48_000 * BAHT;
const VAT = 313_084;
const YEAR = 2024;
const UTF8_BOM = '﻿';

interface Success<T> {
  data: T;
}

describe('Finance exports and role gating (e2e — US-FIN-13/14)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let orgId: number;
  let eventId: string;
  let adminJwt: string;
  let organizerJwt: string;
  let staffJwt: string;
  let seq = 0;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    orgId = await seedOrg(pool);
    eventId = await seedEvent(pool, orgId);

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
    staffJwt = await token(STAFF);
  }, 30000);

  afterEach(async () => {
    await pool.query(`DELETE FROM invoices WHERE organization_id = $1`, [
      orgId,
    ]);
    await pool.query(`DELETE FROM payments WHERE organization_id = $1`, [
      orgId,
    ]);
    await pool.query(`DELETE FROM orders WHERE organization_id = $1`, [orgId]);
    await pool.query(`DELETE FROM audit_events WHERE organization_id = $1`, [
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

  async function seedOrder(buyer = THAI_BUYER): Promise<string> {
    seq += 1;
    const res = await pool.query<{ id: string }>(
      `INSERT INTO orders (organization_id, reference, event_id, buyer_name, buyer_email,
                           status, payment_status, seats, subtotal_satang, vat_amount_satang,
                           total_satang)
       VALUES ($1,$2,$3,$4,'anan@fx.test','confirmed','pending',2,$5,$6,$5) RETURNING id`,
      [orgId, `ORD-FX-${seq}`, eventId, buyer, TOTAL, VAT],
    );
    return res.rows[0].id;
  }

  async function seedPayment(
    orderId: string,
    status: string,
    payer = THAI_BUYER,
    paidAt = `${YEAR}-06-15T03:00:00Z`,
  ) {
    seq += 1;
    await pool.query(
      `INSERT INTO payments (organization_id, txn, order_id, event_id, payer_name,
                             method, amount_satang, status, paid_at, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,'Card',$6,$7,$8,$9)`,
      [
        orgId,
        `TXN-FX-${seq}`,
        orderId,
        eventId,
        payer,
        TOTAL,
        status,
        status === 'pending' ? null : paidAt,
        `idem-fx-${seq}`,
      ],
    );
  }

  const download = (jwt: string, path: string) =>
    request(server).get(path).set('Authorization', `Bearer ${jwt}`);

  const bodyOf = (res: { body: Buffer | object; text?: string }): string =>
    Buffer.isBuffer(res.body) ? res.body.toString('utf8') : (res.text ?? '');

  describe('the payments ledger (US-FIN-13)', () => {
    it('exports exactly the filtered rows, VAT-inclusive', async () => {
      const paid = await seedOrder();
      await seedPayment(paid, 'paid');
      const refunded = await seedOrder();
      await seedPayment(refunded, 'refunded');

      const res = await download(
        adminJwt,
        '/api/v1/payments/export.csv?status=refunded',
      );
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.headers['content-disposition']).toContain('payments.csv');
      const csv = bodyOf(res);
      const lines = csv.trim().split('\n');
      // Header plus exactly the one refunded payment.
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain('refunded');
      // VAT-inclusive Baht, as a number a spreadsheet can sum.
      expect(lines[1]).toContain('48000');
    });

    it('opens with a BOM so Thai names render in a spreadsheet', async () => {
      const orderId = await seedOrder();
      await seedPayment(orderId, 'paid');
      const csv = bodyOf(
        await download(adminJwt, '/api/v1/payments/export.csv'),
      );
      expect(csv.startsWith(UTF8_BOM)).toBe(true);
      expect(csv).toContain(THAI_BUYER);
    });

    it('says there is nothing to export rather than handing back an empty file', async () => {
      const res = await download(
        adminJwt,
        '/api/v1/payments/export.csv?status=failed',
      );
      expect(res.status).toBe(409);
      expect(JSON.stringify(res.body)).toMatch(/nothing to export/i);
    });
  });

  describe('the invoice ledger (US-FIN-13)', () => {
    const issue = (orderId: string) =>
      request(server)
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${adminJwt}`)
        .send({ orderId });

    it('exports only the filtered invoices with reconciling VAT columns', async () => {
      const overdue = await seedOrder();
      const inv = (await issue(overdue)).body as Success<{ id: number }>;
      await pool.query(
        `UPDATE invoices SET issued_at = current_date - 17, due_at = current_date - 3 WHERE id = $1`,
        [inv.data.id],
      );
      await issue(await seedOrder()); // a second, still within its term

      const res = await download(
        adminJwt,
        '/api/v1/invoices/export.csv?status=overdue',
      );
      expect(res.status).toBe(200);
      const lines = bodyOf(res).trim().split('\n');
      expect(lines).toHaveLength(2);
      const columns = lines[0].replace(UTF8_BOM, '').split(',');
      const cells = lines[1].split(',');
      const cell = (name: string) => cells[columns.indexOf(name)];
      // Subtotal + VAT reconcile to the total, in Baht.
      expect(Number(cell('subtotal_baht')) + Number(cell('vat_baht'))).toBe(
        Number(cell('total_baht')),
      );
      expect(Number(cell('total_baht'))).toBe(48_000);
      expect(cell('status')).toBe('overdue');
    });

    it('says there is nothing to export on an empty selection', async () => {
      const res = await download(
        adminJwt,
        '/api/v1/invoices/export.csv?status=void',
      );
      expect(res.status).toBe(409);
    });
  });

  describe('the VAT ledger (US-FIN-13)', () => {
    it('exports the scoped periods with reconciling VAT and remitted figures', async () => {
      const orderId = await seedOrder();
      await seedPayment(orderId, 'paid');
      const res = await download(
        adminJwt,
        `/api/v1/tax-periods/export.csv?year=${YEAR}`,
      );
      expect(res.status).toBe(200);
      const csv = bodyOf(res);
      const lines = csv.trim().split('\n');
      // Header plus twelve months.
      expect(lines).toHaveLength(13);
      const columns = lines[0].replace(UTF8_BOM, '').split(',');
      const june = lines[6].split(',');
      const cell = (name: string) => Number(june[columns.indexOf(name)]);
      expect(cell('vat_payable_baht')).toBe(
        cell('vat_collected_baht') - cell('vat_remitted_baht'),
      );
      // 7% of the taxable base it sits on. The exact integer identity holds in
      // satang; in Baht it is within a rounding step of one satang.
      expect(cell('taxable_sales_baht') * 0.07).toBeCloseTo(
        cell('vat_collected_baht'),
        1,
      );
    });

    it('narrows to a filing status', async () => {
      const res = await download(
        adminJwt,
        `/api/v1/tax-periods/export.csv?year=${YEAR}&status=filed`,
      );
      expect(res.status).toBe(409);
    });
  });

  describe('a formula in stored text cannot execute in a spreadsheet', () => {
    it('neutralises a buyer name that starts like a formula', async () => {
      const orderId = await seedOrder();
      await seedPayment(orderId, 'paid', '=IMPORTXML(1,2)');
      const csv = bodyOf(
        await download(adminJwt, '/api/v1/payments/export.csv'),
      );
      expect(csv).toContain(`"'=IMPORTXML(1,2)"`);
      expect(csv).not.toContain(',=IMPORTXML');
    });
  });

  describe('who may export (US-FIN-14)', () => {
    it('lets an Organizer export all three ledgers', async () => {
      const orderId = await seedOrder();
      await seedPayment(orderId, 'paid');
      expect(
        (await download(organizerJwt, '/api/v1/payments/export.csv')).status,
      ).toBe(200);
      expect(
        (
          await download(
            organizerJwt,
            `/api/v1/tax-periods/export.csv?year=${YEAR}`,
          )
        ).status,
      ).toBe(200);
    });

    it('keeps Finance entirely out of reach for Staff', async () => {
      // US-FIN-14: not merely hidden — unreachable, server-side.
      for (const path of [
        '/api/v1/payments',
        '/api/v1/payments/export.csv',
        '/api/v1/invoices',
        '/api/v1/invoices/export.csv',
        `/api/v1/tax-periods?year=${YEAR}`,
        '/api/v1/payouts',
        '/api/v1/payouts/balances',
      ]) {
        expect((await download(staffJwt, path)).status).toBe(403);
      }
    });
  });
});

const PERM_GROUP: Record<string, string> = {
  finView: 'Finance',
  finManage: 'Finance',
  regView: 'Registrations',
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
    // Staff hold no finance permission at all — the point of US-FIN-14.
    { email: STAFF, roleName: 'Staff', grants: ['regView'] },
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
     VALUES ($1,'fx-summit','FX Summit','Conference','active','upcoming','public',
             now() + interval '30 days','Asia/Bangkok','Acme','QSNCC','Bangkok', now())
     RETURNING id`,
    [orgId],
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
