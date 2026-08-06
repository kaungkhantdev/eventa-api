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
const ORG = { slug: 'inv-e2e', name: 'Invoices E2E' };
const ORG2 = { slug: 'inv-e2e-2', name: 'Invoices E2E 2' };
const ADMIN = 'admin@inv-e2e.test';
const ORGANIZER = 'organizer@inv-e2e.test';
const ADMIN2 = 'admin@inv-e2e-2.test';
const TAX_ID = '0105561234567';
const BAHT = 100;
/** The story's worked example: ฿48,000 VAT-inclusive. */
const TOTAL = 48_000 * BAHT;
/** 7% embedded in ฿48,000, as checkout would have recorded it. */
const VAT = 313_084;
const YEAR = new Date().getUTCFullYear();

interface Success<T> {
  data: T;
}
interface Invoice {
  id: number;
  number: string;
  orderReference: string;
  issuedAt: string;
  dueAt: string;
  daysUntilDue: number;
  subtotalSatang: number;
  vatAmountSatang: number;
  amountSatang: number;
  amountLabel: string;
  status: string;
  paidVia: string | null;
  paidOn: string | null;
  canVoid: boolean;
  voidBlockedReason: string | null;
}
interface Counts {
  issued: number;
  paid: number;
  overdue: number;
  void: number;
}

describe('Tax invoices (e2e — US-FIN-06/07/08/10)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let orgId: number;
  let otherOrgId: number;
  let eventId: string;
  let otherEventId: string;
  let adminJwt: string;
  let organizerJwt: string;
  let seq = 0;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    orgId = await seedOrg(pool, ORG, [
      { email: ADMIN, roleName: 'Admin', grants: ['finView', 'finManage'] },
      { email: ORGANIZER, roleName: 'Organizer', grants: ['finView'] },
    ]);
    otherOrgId = await seedOrg(pool, ORG2, [
      { email: ADMIN2, roleName: 'Admin', grants: ['finView', 'finManage'] },
    ]);
    eventId = await seedEvent(pool, orgId, 'inv-summit');
    otherEventId = await seedEvent(pool, otherOrgId, 'inv-other');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();
    server = app.getHttpServer() as Server;

    adminJwt = await token(ADMIN, ORG.slug);
    organizerJwt = await token(ORGANIZER, ORG.slug);
  }, 30000);

  afterEach(async () => {
    await pool.query(`DELETE FROM invoices WHERE organization_id = ANY($1)`, [
      [orgId, otherOrgId],
    ]);
    await pool.query(`DELETE FROM payments WHERE organization_id = ANY($1)`, [
      [orgId, otherOrgId],
    ]);
    await pool.query(`DELETE FROM orders WHERE organization_id = ANY($1)`, [
      [orgId, otherOrgId],
    ]);
    await pool.query(
      `DELETE FROM audit_events WHERE organization_id = ANY($1)`,
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

  /** An order straight into the table — checkout's own path is proven elsewhere. */
  async function seedOrder(
    o: {
      org?: number;
      event?: string;
      total?: number;
      vat?: number;
      buyerEmail?: string;
      status?: string;
    } = {},
  ): Promise<string> {
    seq += 1;
    const res = await pool.query<{ id: string }>(
      `INSERT INTO orders (organization_id, reference, event_id, buyer_name, buyer_email,
                           status, payment_status, seats, subtotal_satang, vat_amount_satang,
                           total_satang)
       VALUES ($1,$2,$3,'Anan Suksawat',$4,$5,'pending',2,$6,$7,$6) RETURNING id`,
      [
        o.org ?? orgId,
        `ORD-E2E-${seq}`,
        o.event ?? eventId,
        o.buyerEmail ?? 'anan@inv.test',
        o.status ?? 'confirmed',
        o.total ?? TOTAL,
        o.vat ?? VAT,
      ],
    );
    return res.rows[0].id;
  }

  async function seedPayment(orderId: string, method = 'PromptPay') {
    seq += 1;
    await pool.query(
      `INSERT INTO payments (organization_id, txn, order_id, event_id, payer_name,
                             method, amount_satang, status, paid_at, idempotency_key)
       VALUES ($1,$2,$3,$4,'Anan Suksawat',$5,$6,'paid', now(), $7)`,
      [orgId, `TXN-E2E-${seq}`, orderId, eventId, method, TOTAL, `idem-${seq}`],
    );
  }

  const issue = (jwt: string, orderId: string) =>
    request(server)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${jwt}`)
      .send({ orderId });

  const list = (jwt: string, query = '') =>
    request(server)
      .get(`/api/v1/invoices${query}`)
      .set('Authorization', `Bearer ${jwt}`);

  const voidInvoice = (jwt: string, id: number, reason?: string) =>
    request(server)
      .post(`/api/v1/invoices/${id}/void`)
      .set('Authorization', `Bearer ${jwt}`)
      .send(reason ? { reason } : {});

  describe('issuing (US-FIN-07)', () => {
    it('numbers it, dates it 14 days out, and splits VAT back to the total', async () => {
      const res = await issue(adminJwt, await seedOrder());
      expect(res.status).toBe(201);
      const inv = (res.body as Success<Invoice>).data;
      expect(inv.number).toBe(`INV-${YEAR}-0001`);
      expect(inv.amountSatang).toBe(TOTAL);
      expect(inv.subtotalSatang + inv.vatAmountSatang).toBe(TOTAL);
      expect(inv.vatAmountSatang).toBe(VAT);
      expect(inv.amountLabel).toBe('฿48,000');
      expect(inv.status).toBe('issued');
      expect(daysBetween(inv.issuedAt, inv.dueAt)).toBe(14);
    });

    it('keeps the sequence unbroken across invoices', async () => {
      const first = await issue(adminJwt, await seedOrder());
      const second = await issue(adminJwt, await seedOrder());
      expect((first.body as Success<Invoice>).data.number).toBe(
        `INV-${YEAR}-0001`,
      );
      expect((second.body as Success<Invoice>).data.number).toBe(
        `INV-${YEAR}-0002`,
      );
    });

    it('issues exactly one invoice when triggered twice for the same order', async () => {
      const orderId = await seedOrder();
      const first = await issue(adminJwt, orderId);
      const again = await issue(adminJwt, orderId);
      expect((again.body as Success<Invoice>).data.number).toBe(
        (first.body as Success<Invoice>).data.number,
      );
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*) FROM invoices WHERE order_id = $1`,
        [orderId],
      );
      expect(Number(rows[0].count)).toBe(1);
    });

    it('a concurrent double-submit still burns only one number', async () => {
      const orderId = await seedOrder();
      const [a, b] = await Promise.all([
        issue(adminJwt, orderId),
        issue(adminJwt, orderId),
      ]);
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*) FROM invoices WHERE order_id = $1`,
        [orderId],
      );
      expect(Number(rows[0].count)).toBe(1);
    });

    it('reads as Paid, with how and when, once the order is settled', async () => {
      const orderId = await seedOrder();
      await seedPayment(orderId, 'PromptPay');
      const inv = (await issue(adminJwt, orderId)).body as Success<Invoice>;
      expect(inv.data.status).toBe('paid');
      expect(inv.data.paidVia).toBe('PromptPay');
      expect(inv.data.paidOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('refuses an order with nothing to bill', async () => {
      const res = await issue(adminJwt, await seedOrder({ total: 0, vat: 0 }));
      expect(res.status).toBe(422);
    });

    it('refuses an order from another workspace', async () => {
      const foreign = await seedOrder({
        org: otherOrgId,
        event: otherEventId,
      });
      expect((await issue(adminJwt, foreign)).status).toBe(404);
    });

    it('records the issue in the audit trail', async () => {
      await issue(adminJwt, await seedOrder());
      const { rows } = await pool.query<{ type: string; title: string }>(
        `SELECT type, title FROM audit_events WHERE organization_id = $1`,
        [orgId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe('invoice');
      expect(rows[0].title).toMatch(/Issued invoice INV-/);
    });
  });

  describe('the ledger with ageing (US-FIN-06)', () => {
    it('ages an unpaid invoice past its term to Overdue', async () => {
      const orderId = await seedOrder();
      const id = (await issue(adminJwt, orderId)).body as Success<Invoice>;
      // Backdate it so its 14-day term ran out three days ago.
      await pool.query(
        `UPDATE invoices SET issued_at = current_date - 17, due_at = current_date - 3 WHERE id = $1`,
        [id.data.id],
      );
      const res = await list(adminJwt);
      const [row] = (res.body as Success<Invoice[]>).data;
      expect(row.status).toBe('overdue');
      expect(row.daysUntilDue).toBe(-3);
    });

    it('shows an invoice still within its term as Issued', async () => {
      const id = (
        (await issue(adminJwt, await seedOrder())).body as Success<Invoice>
      ).data;
      await pool.query(
        `UPDATE invoices SET due_at = current_date + 9 WHERE id = $1`,
        [id.id],
      );
      const [row] = ((await list(adminJwt)).body as Success<Invoice[]>).data;
      expect(row.status).toBe('issued');
      expect(row.daysUntilDue).toBe(9);
    });

    it('counts every status across the whole ledger, not just the page', async () => {
      const paidOrder = await seedOrder();
      await seedPayment(paidOrder);
      await issue(adminJwt, paidOrder);
      await issue(adminJwt, await seedOrder());
      const res = await list(adminJwt, '?status=paid');
      const counts = (res.body as { meta: { counts: Counts } }).meta.counts;
      expect(counts).toEqual({ issued: 1, paid: 1, overdue: 0, void: 0 });
      // …while the page itself is narrowed to the filter.
      expect((res.body as Success<Invoice[]>).data).toHaveLength(1);
    });

    it('narrows by invoice number and by buyer name', async () => {
      await issue(adminJwt, await seedOrder());
      const hit = await list(adminJwt, `?search=INV-${YEAR}-0001`);
      expect((hit.body as Success<Invoice[]>).data).toHaveLength(1);
      const miss = await list(adminJwt, '?search=Somchai');
      expect((miss.body as Success<Invoice[]>).data).toHaveLength(0);
      const byBuyer = await list(adminJwt, '?search=Anan');
      expect((byBuyer.body as Success<Invoice[]>).data).toHaveLength(1);
    });

    it('narrows by event', async () => {
      await issue(adminJwt, await seedOrder());
      const hit = await list(adminJwt, `?eventId=${eventId}`);
      expect((hit.body as Success<Invoice[]>).data).toHaveLength(1);
      const miss = await list(adminJwt, `?eventId=${otherEventId}`);
      expect((miss.body as Success<Invoice[]>).data).toHaveLength(0);
    });

    it('never shows another workspace its invoices', async () => {
      await issue(adminJwt, await seedOrder());
      const other = await token(ADMIN2, ORG2.slug);
      expect((await list(other)).body).toMatchObject({ data: [] });
    });
  });

  describe('the printable tax invoice (US-FIN-08)', () => {
    it('carries the legal identity, the VAT split and the event line', async () => {
      const inv = (
        (await issue(adminJwt, await seedOrder())).body as Success<Invoice>
      ).data;
      const res = await request(server)
        .get(`/api/v1/invoices/${inv.id}/invoice.svg`)
        .set('Authorization', `Bearer ${adminJwt}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/image\/svg/);
      // supertest hands back a Buffer for image/svg+xml, not `text`.
      const svg = (res.body as Buffer).toString();
      expect(svg).toContain('TAX INVOICE');
      expect(svg).toContain(ORG.name);
      expect(svg).toContain(TAX_ID);
      expect(svg).toContain('VAT 7%');
      expect(svg).toContain('฿48,000');
      expect(svg).toContain('Inv Summit');
    });

    it('stamps a voided invoice VOID', async () => {
      const inv = (
        (await issue(adminJwt, await seedOrder())).body as Success<Invoice>
      ).data;
      await voidInvoice(adminJwt, inv.id);
      const res = await request(server)
        .get(`/api/v1/invoices/${inv.id}/invoice.svg`)
        .set('Authorization', `Bearer ${adminJwt}`);
      expect((res.body as Buffer).toString()).toContain('VOID');
    });

    it('does not resolve an invoice from another workspace', async () => {
      const inv = (
        (await issue(adminJwt, await seedOrder())).body as Success<Invoice>
      ).data;
      const other = await token(ADMIN2, ORG2.slug);
      const res = await request(server)
        .get(`/api/v1/invoices/${inv.id}`)
        .set('Authorization', `Bearer ${other}`);
      expect(res.status).toBe(404);
    });
  });

  describe('voiding (US-FIN-10)', () => {
    it('voids an issued invoice, keeps its number, and records why', async () => {
      const inv = (
        (await issue(adminJwt, await seedOrder())).body as Success<Invoice>
      ).data;
      const res = await voidInvoice(adminJwt, inv.id, 'Raised in error');
      expect(res.status).toBe(200);
      const voided = (res.body as Success<Invoice>).data;
      expect(voided.status).toBe('void');
      expect(voided.number).toBe(inv.number);
      expect(voided.canVoid).toBe(false);
      const { rows } = await pool.query<{ title: string; meta: string }>(
        `SELECT title, meta FROM audit_events
         WHERE organization_id = $1 AND title LIKE 'Voided%'`,
        [orgId],
      );
      expect(rows[0].meta).toBe('Raised in error');
    });

    it('drops the voided invoice out of outstanding receivables', async () => {
      const inv = (
        (await issue(adminJwt, await seedOrder())).body as Success<Invoice>
      ).data;
      await voidInvoice(adminJwt, inv.id);
      const body = (await list(adminJwt)).body as { meta: { counts: Counts } };
      expect(body.meta.counts).toEqual({
        issued: 0,
        paid: 0,
        overdue: 0,
        void: 1,
      });
    });

    it('a correction is a NEW number — the voided one is never reused', async () => {
      const orderId = await seedOrder();
      const first = ((await issue(adminJwt, orderId)).body as Success<Invoice>)
        .data;
      await voidInvoice(adminJwt, first.id);
      const replacement = await issue(adminJwt, orderId);
      expect(replacement.status).toBe(201);
      expect((replacement.body as Success<Invoice>).data.number).toBe(
        `INV-${YEAR}-0002`,
      );
    });

    it('refuses to void a paid invoice, pointing at the refund instead', async () => {
      const orderId = await seedOrder();
      await seedPayment(orderId);
      const inv = ((await issue(adminJwt, orderId)).body as Success<Invoice>)
        .data;
      const res = await voidInvoice(adminJwt, inv.id);
      expect(res.status).toBe(409);
      expect((res.body as { message: string }).message).toMatch(/refund/i);
    });

    it('refuses to void an already-void invoice', async () => {
      const inv = (
        (await issue(adminJwt, await seedOrder())).body as Success<Invoice>
      ).data;
      await voidInvoice(adminJwt, inv.id);
      expect((await voidInvoice(adminJwt, inv.id)).status).toBe(409);
    });
  });

  describe('who may do what (US-FIN-14)', () => {
    it('lets an Organizer read the ledger and issue an invoice', async () => {
      expect((await list(organizerJwt)).status).toBe(200);
      expect((await issue(organizerJwt, await seedOrder())).status).toBe(201);
    });

    it('denies an Organizer the void', async () => {
      const inv = (
        (await issue(adminJwt, await seedOrder())).body as Success<Invoice>
      ).data;
      expect((await voidInvoice(organizerJwt, inv.id)).status).toBe(403);
      // …and the invoice is untouched.
      const { rows } = await pool.query<{ status: string }>(
        `SELECT status FROM invoices WHERE id = $1`,
        [inv.id],
      );
      expect(rows[0].status).toBe('issued');
    });

    it('refuses an unauthenticated caller outright', async () => {
      expect((await request(server).get('/api/v1/invoices')).status).toBe(401);
    });
  });
});

function daysBetween(from: string, to: string): number {
  const MS_PER_DAY = 86_400_000;
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      MS_PER_DAY,
  );
}

const PERM_GROUP: Record<string, string> = {
  finView: 'Finance',
  finManage: 'Finance',
};

async function seedOrg(
  pool: Pool,
  org: { slug: string; name: string },
  people: { email: string; roleName: string; grants: string[] }[],
): Promise<number> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug, vat_rate, address, tax_id)
     VALUES ($1, $2, 0.0700, '99 Sukhumvit Road, Bangkok 10110', $3) RETURNING id`,
    [org.name, org.slug, TAX_ID],
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

async function seedEvent(
  pool: Pool,
  orgId: number,
  slug: string,
): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO events (organization_id, slug, name, type, bucket, status, visibility,
                         start_at, timezone, organizer_name, venue_name, city, published_at)
     VALUES ($1,$2,'Inv Summit','Conference','active','upcoming','public',
             now() + interval '30 days','Asia/Bangkok','Acme','QSNCC','Bangkok', now())
     RETURNING id`,
    [orgId, slug],
  );
  return res.rows[0].id;
}

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM audit_events WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug = ANY($1))`,
    [[ORG.slug, ORG2.slug]],
  );
  await pool.query(`DELETE FROM organizations WHERE slug = ANY($1)`, [
    [ORG.slug, ORG2.slug],
  ]);
}
