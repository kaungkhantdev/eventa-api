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
const ORG = { slug: 'po-e2e', name: 'Payouts E2E' };
const ADMIN = 'admin@po-e2e.test';
const ORGANIZER = 'organizer@po-e2e.test';
const BAHT = 100;
const COLLECTED = 500_000 * BAHT;
const PAID_OUT = 200_000 * BAHT;
const IN_FLIGHT = 80_000 * BAHT;
const ACCOUNT = 'acct_e2e_123';

interface Success<T> {
  data: T;
}
interface Payout {
  reference: string;
  amountSatang: number;
  amountLabel: string;
  bankAccount: string;
  status: string;
  requestedAt: string;
  completedAt: string | null;
  failureReason: string | null;
  canRetry: boolean;
  timeline?: { step: string; done: boolean; note: string | null }[];
  canDownloadReceipt?: boolean;
}
interface Balances {
  availableSatang: number | null;
  pendingSatang: number | null;
  paidOutSatang: number | null;
  availableLabel: string | null;
  payoutsConnected: boolean;
}
interface SettingsLink {
  connected: boolean;
  url: string | null;
}

describe('Payouts (e2e — US-FIN-03/04/05)', () => {
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

  beforeEach(async () => {
    await connectPayouts(true);
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM payout_items WHERE organization_id = $1`, [
      orgId,
    ]);
    await pool.query(`DELETE FROM payouts WHERE organization_id = $1`, [orgId]);
    await pool.query(`DELETE FROM payments WHERE organization_id = $1`, [
      orgId,
    ]);
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

  async function connectPayouts(connected: boolean) {
    await pool.query(
      `INSERT INTO payment_settings (organization_id, provider, status, account_id)
       VALUES ($1,'stripe',$2,$3)
       ON CONFLICT (organization_id) DO UPDATE
         SET status = EXCLUDED.status, account_id = EXCLUDED.account_id`,
      [
        orgId,
        connected ? 'connected' : 'disconnected',
        connected ? ACCOUNT : null,
      ],
    );
  }

  async function seedPayment(amount: number): Promise<string> {
    seq += 1;
    const res = await pool.query<{ id: string }>(
      `INSERT INTO payments (organization_id, txn, order_id, event_id, payer_name,
                             method, amount_satang, status, paid_at, idempotency_key)
       VALUES ($1,$2,$3,$4,'Anan','Card',$5,'paid', now(), $6) RETURNING id`,
      [orgId, `TXN-PO-${seq}`, orderId, eventId, amount, `idem-po-${seq}`],
    );
    return res.rows[0].id;
  }

  async function seedPayout(
    o: { status?: string; amount?: number; completed?: boolean } = {},
  ): Promise<string> {
    seq += 1;
    const reference = `PO-E2E-${seq}`;
    await pool.query(
      `INSERT INTO payouts (organization_id, reference, amount_satang, bank_account,
                            status, period_covered, requested_at, completed_at)
       VALUES ($1,$2,$3,'1234567890',$4,'Jun 2026', now() - interval '2 days', $5)`,
      [
        orgId,
        reference,
        o.amount ?? IN_FLIGHT,
        o.status ?? 'processing',
        o.completed ? new Date() : null,
      ],
    );
    return reference;
  }

  /** A payout that has actually settled money, so `available` drops by it. */
  async function allocate(reference: string, amount: number) {
    const paymentId = await seedPayment(amount);
    const payout = await pool.query<{ id: string }>(
      `SELECT id FROM payouts WHERE organization_id = $1 AND reference = $2`,
      [orgId, reference],
    );
    await pool.query(
      `INSERT INTO payout_items (organization_id, payout_id, payment_id,
                                 gross_satang, refund_satang, fee_satang, net_satang)
       VALUES ($1,$2,$3,$4,0,0,$4)`,
      [orgId, Number(payout.rows[0].id), paymentId, amount],
    );
  }

  const balances = (jwt: string) =>
    request(server)
      .get('/api/v1/payouts/balances')
      .set('Authorization', `Bearer ${jwt}`);

  const list = (jwt: string, query = '') =>
    request(server)
      .get(`/api/v1/payouts${query}`)
      .set('Authorization', `Bearer ${jwt}`);

  const detail = (jwt: string, reference: string) =>
    request(server)
      .get(`/api/v1/payouts/${reference}`)
      .set('Authorization', `Bearer ${jwt}`);

  const retry = (jwt: string, reference: string) =>
    request(server)
      .post(`/api/v1/payouts/${reference}/retry`)
      .set('Authorization', `Bearer ${jwt}`)
      .send({});

  const settingsLink = (jwt: string) =>
    request(server)
      .post('/api/v1/payouts/settings-link')
      .set('Authorization', `Bearer ${jwt}`)
      .send({});

  describe('balances (US-FIN-03)', () => {
    it('shows available, pending and paid-out to date', async () => {
      await seedPayment(COLLECTED);
      const paidRef = await seedPayout({
        status: 'paid',
        amount: PAID_OUT,
        completed: true,
      });
      await allocate(paidRef, PAID_OUT);
      await seedPayout({ status: 'processing', amount: IN_FLIGHT });

      const res = await balances(adminJwt);
      expect(res.status).toBe(200);
      const body = (res.body as Success<Balances>).data;
      expect(body.payoutsConnected).toBe(true);
      // Collected (the sale + the allocated one) minus what is allocated.
      expect(body.availableSatang).toBe(COLLECTED);
      expect(body.pendingSatang).toBe(IN_FLIGHT);
      expect(body.paidOutSatang).toBe(PAID_OUT);
      expect(body.availableLabel).toBe('฿500,000');
    });

    it('matches pending to the payout actually in flight', async () => {
      await seedPayout({ status: 'processing', amount: IN_FLIGHT });
      const body = (await balances(adminJwt)).body as Success<Balances>;
      expect(body.data.pendingSatang).toBe(IN_FLIGHT);
    });

    it('reads as unavailable when no payout account is connected', async () => {
      await connectPayouts(false);
      const body = (await balances(adminJwt)).body as Success<Balances>;
      expect(body.data.payoutsConnected).toBe(false);
      expect(body.data.availableSatang).toBeNull();
      expect(body.data.pendingSatang).toBeNull();
      expect(body.data.paidOutSatang).toBeNull();
    });
  });

  describe('history (US-FIN-03)', () => {
    it('lists payouts with a masked destination and its dates', async () => {
      await seedPayout({ status: 'paid', completed: true });
      const res = await list(adminJwt);
      const [row] = (res.body as Success<Payout[]>).data;
      expect(row.bankAccount).toBe('•••• 7890');
      expect(row.bankAccount).not.toContain('123456');
      expect(row.requestedAt).toBeTruthy();
      expect(row.completedAt).toBeTruthy();
      expect(row.amountLabel).toBe('฿80,000');
    });

    it('narrows by status', async () => {
      await seedPayout({ status: 'failed' });
      await seedPayout({ status: 'paid', completed: true });
      const failed = (await list(adminJwt, '?status=failed')).body as Success<
        Payout[]
      >;
      expect(failed.data).toHaveLength(1);
      expect(failed.data[0].status).toBe('failed');
      expect(failed.data[0].canRetry).toBe(true);
    });

    it('never shows a full account number anywhere in the response', async () => {
      await seedPayout({ status: 'paid', completed: true });
      const res = await list(adminJwt);
      expect(JSON.stringify(res.body)).not.toContain('1234567890');
    });
  });

  describe('one payout and its timeline (US-FIN-04)', () => {
    it('explains a transfer in flight in plain language', async () => {
      const ref = await seedPayout({ status: 'processing' });
      const row = (await detail(adminJwt, ref)).body as Success<Payout>;
      expect(row.data.timeline?.map((t) => t.step)).toEqual([
        'requested',
        'processing',
        'paid',
      ]);
      const processing = row.data.timeline?.find(
        (t) => t.step === 'processing',
      );
      expect(processing?.note).toMatch(/1–3 business days/);
      expect(row.data.canDownloadReceipt).toBe(false);
    });

    it('offers a receipt once the money has landed', async () => {
      const ref = await seedPayout({ status: 'paid', completed: true });
      const row = (await detail(adminJwt, ref)).body as Success<Payout>;
      expect(row.data.canDownloadReceipt).toBe(true);
    });

    it('does not resolve a payout from another workspace', async () => {
      expect((await detail(adminJwt, 'PO-NOT-MINE')).status).toBe(404);
    });
  });

  describe('recovering a failed payout (US-FIN-04)', () => {
    it('moves the SAME payout to processing without creating a second', async () => {
      const ref = await seedPayout({ status: 'failed' });
      const res = await retry(adminJwt, ref);
      expect(res.status).toBe(200);
      expect((res.body as Success<Payout>).data.status).toBe('processing');
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*) FROM payouts WHERE organization_id = $1`,
        [orgId],
      );
      expect(Number(rows[0].count)).toBe(1);
    });

    it('records the retry for audit', async () => {
      const ref = await seedPayout({ status: 'failed' });
      await retry(adminJwt, ref);
      const { rows } = await pool.query<{ type: string; title: string }>(
        `SELECT type, title FROM audit_events WHERE organization_id = $1`,
        [orgId],
      );
      expect(rows[0].type).toBe('payout');
      expect(rows[0].title).toContain(ref);
    });

    it('refuses to retry a payout that has not failed', async () => {
      const ref = await seedPayout({ status: 'processing' });
      expect((await retry(adminJwt, ref)).status).toBe(409);
    });

    it('refuses to retry when no payout account is connected', async () => {
      const ref = await seedPayout({ status: 'failed' });
      await connectPayouts(false);
      const res = await retry(adminJwt, ref);
      expect(res.status).toBe(409);
      expect((res.body as { message: string }).message).toMatch(/connect/i);
    });
  });

  describe('managing bank details at the provider (US-FIN-05)', () => {
    it('hands an Admin a link to the provider’s own dashboard', async () => {
      const res = await settingsLink(adminJwt);
      expect(res.status).toBe(200);
      const link = (res.body as Success<SettingsLink>).data;
      expect(link.connected).toBe(true);
      expect(link.url).toContain(ACCOUNT);
    });

    it('asks the organizer to connect first when there is no account', async () => {
      await connectPayouts(false);
      const link = (await settingsLink(adminJwt)).body as Success<SettingsLink>;
      expect(link.data.connected).toBe(false);
      expect(link.data.url).toBeNull();
    });
  });

  describe('who may do what (US-FIN-14)', () => {
    it('lets an Organizer see balances and history', async () => {
      expect((await balances(organizerJwt)).status).toBe(200);
      expect((await list(organizerJwt)).status).toBe(200);
    });

    it('denies an Organizer the retry and the bank settings', async () => {
      const ref = await seedPayout({ status: 'failed' });
      expect((await retry(organizerJwt, ref)).status).toBe(403);
      expect((await settingsLink(organizerJwt)).status).toBe(403);
      const { rows } = await pool.query<{ status: string }>(
        `SELECT status FROM payouts WHERE organization_id = $1`,
        [orgId],
      );
      expect(rows[0].status).toBe('failed');
    });

    it('refuses an unauthenticated caller outright', async () => {
      expect((await request(server).get('/api/v1/payouts')).status).toBe(401);
    });
  });
});

const PERM_GROUP: Record<string, string> = {
  finView: 'Finance',
  finManage: 'Finance',
};

async function seedOrg(pool: Pool): Promise<number> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
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
     VALUES ($1,'po-summit','Payout Summit','Conference','active','upcoming','public',
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
     VALUES ($1,'ORD-PO-1',$2,'Anan','anan@po.test','confirmed','paid',2,$3,0,$3)
     RETURNING id`,
    [orgId, eventId, COLLECTED],
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
