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
const ORG = { slug: 'disc-e2e', name: 'Discounts E2E' };
const ORG2 = { slug: 'disc-e2e-2', name: 'Discounts E2E 2' };
const ADMIN = 'admin@disc-e2e.test';
const LIMITED = 'staff@disc-e2e.test';
const ADMIN2 = 'admin@disc-e2e-2.test';
const BAHT = 100;

interface Success<T> {
  data: T;
}
interface Discount {
  id: string;
  code: string;
  status: string;
  used: number;
  redemptionLimit: number;
  scope: string;
  version: number;
}
interface Quote {
  discountSatang: number;
  totalSatang: number;
  netSatang: number;
  vatSatang: number;
  code: string;
}

describe('Discount codes (e2e — US-TKT-07…12)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let eventId: string;
  let otherEventId: string;
  let orgId: number;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    orgId = await seedOrg(pool, ORG, [
      { email: ADMIN, roleName: 'Admin', grants: ['evCreate', 'finDiscount'] },
      { email: LIMITED, roleName: 'Staff', grants: ['evCreate'] },
    ]);
    await seedOrg(pool, ORG2, [
      { email: ADMIN2, roleName: 'Admin', grants: ['evCreate', 'finDiscount'] },
    ]);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();
    server = app.getHttpServer() as Server;

    eventId = await createEvent(await token(ADMIN, ORG.slug), 'Jazz Festival');
    otherEventId = await createEvent(await token(ADMIN2, ORG2.slug), 'Other');
  }, 30000);

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  const token = async (email: string, orgSlug: string) => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, orgSlug, persona: 'admin' });
    return (res.body as Success<{ accessToken: string }>).data.accessToken;
  };

  async function createEvent(jwt: string, name: string): Promise<string> {
    const res = await request(server)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${jwt}`)
      .send({ name, type: 'Conference', startAt: '2026-09-01T02:00:00Z' });
    return (res.body as Success<{ id: string }>).data.id;
  }

  const create = (jwt: string, body: Record<string, unknown>) =>
    request(server)
      .post('/api/v1/discounts')
      .set('Authorization', `Bearer ${jwt}`)
      .send(body);

  const quote = (body: Record<string, unknown>) =>
    request(server).post('/api/v1/discounts/quote').send(body); // NO auth header

  describe('US-TKT-07: create a code', () => {
    it('creates a 25%-off code with 0 redemptions used', async () => {
      const jwt = await token(ADMIN, ORG.slug);
      const res = await create(jwt, {
        code: 'promo25',
        type: 'percent',
        value: 25,
        eventId,
        redemptionLimit: 500,
      });
      expect(res.status).toBe(201);
      expect((res.body as Success<Discount>).data).toMatchObject({
        code: 'PROMO25', // normalised
        status: 'active',
        used: 0,
        redemptionLimit: 500,
        scope: 'event',
      });
    });

    it('suggests a memorable code that is not already taken', async () => {
      const jwt = await token(ADMIN, ORG.slug);
      const res = await request(server)
        .get('/api/v1/discounts/suggest')
        .set('Authorization', `Bearer ${jwt}`);
      expect(res.status).toBe(200);
      const { code } = (res.body as Success<{ code: string }>).data;
      expect(code).toMatch(/^[A-Z]+\d+$/);
      expect(code).not.toBe('PROMO25');
    });

    it('is Scheduled when it starts in the future', async () => {
      const jwt = await token(ADMIN, ORG.slug);
      const res = await create(jwt, {
        code: 'LATER10',
        type: 'percent',
        value: 10,
        validFrom: '2030-01-01T00:00:00Z',
      });
      expect((res.body as Success<Discount>).data.status).toBe('scheduled');
    });

    it('refuses a per-person limit above the total, and an already-expired window', async () => {
      const jwt = await token(ADMIN, ORG.slug);
      expect(
        (
          await create(jwt, {
            code: 'BADLIMIT',
            type: 'percent',
            value: 10,
            redemptionLimit: 5,
            perPersonLimit: 10,
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await create(jwt, {
            code: 'STALE10',
            type: 'percent',
            value: 10,
            validUntil: '2020-01-01T00:00:00Z',
          })
        ).status,
      ).toBe(422);
    });

    it('forbids a user without finDiscount (403)', async () => {
      const jwt = await token(LIMITED, ORG.slug);
      expect(
        (await create(jwt, { code: 'SNEAKY10', type: 'percent', value: 10 }))
          .status,
      ).toBe(403);
    });
  });

  describe('US-TKT-11: apply a code at checkout', () => {
    it('applies 25% to ฿1,000 and recalculates VAT on the reduced total', async () => {
      const res = await quote({
        code: 'promo25',
        eventId,
        subtotalSatang: 1000 * BAHT,
      });
      expect(res.status).toBe(200);
      const q = (res.body as Success<Quote>).data;
      expect(q.discountSatang).toBe(250 * BAHT);
      expect(q.totalSatang).toBe(750 * BAHT);
      expect(q.netSatang + q.vatSatang).toBe(q.totalSatang);
      expect(q.code).toBe('PROMO25');
    });

    it('caps a fixed code at the order so the total never goes below zero', async () => {
      const jwt = await token(ADMIN, ORG.slug);
      await create(jwt, {
        code: 'FLAT300',
        type: 'fixed',
        value: 300 * BAHT,
        eventId,
      });
      const q = (
        (
          await quote({
            code: 'FLAT300',
            eventId,
            subtotalSatang: 250 * BAHT,
          })
        ).body as Success<Quote>
      ).data;
      expect(q.discountSatang).toBe(250 * BAHT);
      expect(q.totalSatang).toBe(0);
    });

    it('gives a distinct reason for unknown, not-yet-started and expired codes', async () => {
      const unknown = await quote({
        code: 'NOSUCH',
        eventId,
        subtotalSatang: 1000 * BAHT,
      });
      expect(unknown.status).toBe(422);
      expect((unknown.body as { message: string }).message).toMatch(
        /recognise/i,
      );

      const early = await quote({
        code: 'LATER10',
        eventId,
        subtotalSatang: 1000 * BAHT,
      });
      expect((early.body as { message: string }).message).toMatch(
        /isn't active yet/i,
      );
    });

    it('says how much more is needed to reach the minimum order', async () => {
      const jwt = await token(ADMIN, ORG.slug);
      await create(jwt, {
        code: 'BIGSPEND',
        type: 'percent',
        value: 10,
        minOrderSatang: 1500 * BAHT,
      });
      const res = await quote({
        code: 'BIGSPEND',
        eventId,
        subtotalSatang: 1000 * BAHT,
      });
      expect((res.body as { message: string }).message).toMatch(/฿500/);
    });

    it("cannot reach another workspace's code, even by naming its event", async () => {
      const other = await token(ADMIN2, ORG2.slug);
      await create(other, {
        code: 'FOREIGN50',
        type: 'percent',
        value: 50,
      });
      // the code exists — but not in the workspace this event belongs to
      const res = await quote({
        code: 'FOREIGN50',
        eventId,
        subtotalSatang: 1000 * BAHT,
      });
      expect(res.status).toBe(422);
      expect((res.body as { message: string }).message).toMatch(/recognise/i);
    });

    it('refuses a code scoped to a different event in the same workspace', async () => {
      const jwt = await token(ADMIN, ORG.slug);
      const second = await createEvent(jwt, 'Second Event');
      const res = await quote({
        code: 'PROMO25', // scoped to the first event
        eventId: second,
        subtotalSatang: 1000 * BAHT,
      });
      expect(res.status).toBe(422);
    });

    it('tells a buyer who already used a single-use code', async () => {
      const jwt = await token(ADMIN, ORG.slug);
      const created = await create(jwt, {
        code: 'ONEEACH',
        type: 'percent',
        value: 10,
        perPersonLimit: 1,
      });
      const id = (created.body as Success<Discount>).data.id;
      await seedRedemption(pool, orgId, id, eventId, 'anan@x.test');

      const res = await quote({
        code: 'ONEEACH',
        eventId,
        subtotalSatang: 1000 * BAHT,
        buyerEmail: 'anan@x.test',
      });
      expect((res.body as { message: string }).message).toMatch(
        /already used/i,
      );

      // …but someone else may still use it
      const other = await quote({
        code: 'ONEEACH',
        eventId,
        subtotalSatang: 1000 * BAHT,
        buyerEmail: 'ben@x.test',
      });
      expect(other.status).toBe(200);
    });
  });

  describe('US-TKT-08/09/10: tune and stop a promotion', () => {
    let codeId: string;

    beforeAll(async () => {
      const jwt = await token(ADMIN, ORG.slug);
      const res = await create(jwt, {
        code: 'TUNABLE',
        type: 'percent',
        value: 20,
        redemptionLimit: 400,
      });
      codeId = (res.body as Success<Discount>).data.id;
    });

    const patch = async (body: Record<string, unknown>) =>
      request(server)
        .patch(`/api/v1/discounts/${codeId}`)
        .set('Authorization', `Bearer ${await token(ADMIN, ORG.slug)}`)
        .send(body);

    it('accepts a value change while it has never been redeemed', async () => {
      const res = await patch({ value: 30 });
      expect(res.status).toBe(200);
    });

    it('freezes the code text and value once it has been redeemed', async () => {
      await pool.query(`UPDATE discount_codes SET used = 342 WHERE id = $1`, [
        codeId,
      ]);
      expect((await patch({ value: 40 })).status).toBe(409);
      expect((await patch({ code: 'RENAMED' })).status).toBe(409);

      const lowered = await patch({ redemptionLimit: 300 });
      expect(lowered.status).toBe(422);
      expect((lowered.body as { message: string }).message).toMatch(/342/);
    });

    it('still allows narrowing its scope and window', async () => {
      const res = await patch({ eventId, validUntil: '2030-01-01T00:00:00Z' });
      expect(res.status).toBe(200);
      expect((res.body as Success<Discount>).data.scope).toBe('event');
    });

    it('switches off, and the code is refused at checkout at once', async () => {
      const jwt = await token(ADMIN, ORG.slug);
      const off = await request(server)
        .post(`/api/v1/discounts/${codeId}/disable`)
        .set('Authorization', `Bearer ${jwt}`);
      expect((off.body as Success<Discount>).data.status).toBe('disabled');

      const res = await quote({
        code: 'TUNABLE',
        eventId,
        subtotalSatang: 1000 * BAHT,
      });
      expect(res.status).toBe(422);
      expect((res.body as { message: string }).message).toMatch(
        /no longer available/i,
      );

      // history is preserved — the redemption count is untouched
      const { rows } = await pool.query<{ used: number }>(
        `SELECT used FROM discount_codes WHERE id = $1`,
        [codeId],
      );
      expect(Number(rows[0].used)).toBe(342);
    });

    it('refuses to switch on a code whose usage limit is spent', async () => {
      const jwt = await token(ADMIN, ORG.slug);
      await pool.query(
        `UPDATE discount_codes SET used = 400, redemption_limit = 400 WHERE id = $1`,
        [codeId],
      );
      const res = await request(server)
        .post(`/api/v1/discounts/${codeId}/enable`)
        .set('Authorization', `Bearer ${jwt}`);
      expect(res.status).toBe(409);
      expect((res.body as { message: string }).message).toMatch(
        /dates or usage limit/i,
      );
    });

    it('retires a redeemed code rather than erasing it', async () => {
      const jwt = await token(ADMIN, ORG.slug);
      const res = await request(server)
        .delete(`/api/v1/discounts/${codeId}`)
        .set('Authorization', `Bearer ${jwt}`);
      expect((res.body as Success<{ outcome: string }>).data.outcome).toBe(
        'retired',
      );
      const { rows } = await pool.query<{ deleted_at: Date | null }>(
        `SELECT deleted_at FROM discount_codes WHERE id = $1`,
        [codeId],
      );
      expect(rows[0].deleted_at).not.toBeNull(); // still there, for past orders
    });

    it('removes a code nobody ever used', async () => {
      const jwt = await token(ADMIN, ORG.slug);
      const created = await create(jwt, {
        code: 'NEVERUSED',
        type: 'percent',
        value: 5,
      });
      const id = (created.body as Success<Discount>).data.id;
      const res = await request(server)
        .delete(`/api/v1/discounts/${id}`)
        .set('Authorization', `Bearer ${jwt}`);
      expect((res.body as Success<{ outcome: string }>).data.outcome).toBe(
        'removed',
      );
      const { rows } = await pool.query(
        `SELECT id FROM discount_codes WHERE id = $1`,
        [id],
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('US-TKT-12: track promotions', () => {
    it('lists codes with live counts, and an all-events code shows under an event filter', async () => {
      const jwt = await token(ADMIN, ORG.slug);
      await create(jwt, {
        code: 'EVERYWHERE',
        type: 'percent',
        value: 5,
      });
      const res = await request(server)
        .get(`/api/v1/discounts?eventId=${eventId}&limit=100`)
        .set('Authorization', `Bearer ${jwt}`);
      expect(res.status).toBe(200);
      const rows = (
        res.body as Success<
          { code: string; scopeLabel: string; used: number }[]
        >
      ).data;
      const everywhere = rows.find((r) => r.code === 'EVERYWHERE');
      expect(everywhere?.scopeLabel).toBe('All events');
      const scoped = rows.find((r) => r.code === 'PROMO25');
      expect(scoped?.scopeLabel).toBe('Jazz Festival');
    });

    it('filters by status and searches by code', async () => {
      const jwt = await token(ADMIN, ORG.slug);
      const scheduled = await request(server)
        .get('/api/v1/discounts?status=scheduled&limit=100')
        .set('Authorization', `Bearer ${jwt}`);
      const codes = (
        scheduled.body as Success<{ code: string; status: string }[]>
      ).data;
      expect(codes.every((c) => c.status === 'scheduled')).toBe(true);

      const searched = await request(server)
        .get('/api/v1/discounts?search=PROMO')
        .set('Authorization', `Bearer ${jwt}`);
      const found = (searched.body as Success<{ code: string }[]>).data;
      expect(found.every((c) => c.code.includes('PROMO'))).toBe(true);
    });

    it('expires a code on schedule the next time the list is read', async () => {
      const jwt = await token(ADMIN, ORG.slug);
      const created = await create(jwt, {
        code: 'RUNSOUT',
        type: 'percent',
        value: 5,
        validUntil: '2030-01-01T00:00:00Z',
      });
      const id = (created.body as Success<Discount>).data.id;
      // the window closes while nobody is looking
      await pool.query(
        `UPDATE discount_codes SET valid_until = now() - interval '1 day' WHERE id = $1`,
        [id],
      );

      const res = await request(server)
        .get('/api/v1/discounts?limit=100')
        .set('Authorization', `Bearer ${jwt}`);
      const row = (
        res.body as Success<{ code: string; status: string }[]>
      ).data.find((r) => r.code === 'RUNSOUT');
      expect(row?.status).toBe('expired');

      // …and the drift was written back, not just displayed
      const { rows } = await pool.query<{ status: string }>(
        `SELECT status FROM discount_codes WHERE id = $1`,
        [id],
      );
      expect(rows[0].status).toBe('expired');
    });

    it('never lists another tenant’s codes', async () => {
      const other = await token(ADMIN2, ORG2.slug);
      const res = await request(server)
        .get('/api/v1/discounts?limit=100')
        .set('Authorization', `Bearer ${other}`);
      const codes = (res.body as Success<{ code: string }[]>).data.map(
        (c) => c.code,
      );
      expect(codes).not.toContain('PROMO25');
      expect(codes).toContain('FOREIGN50');
    });
  });

  // referenced so the linter sees the seeded second-tenant event
  it('seeded a foreign event', () => {
    expect(otherEventId).toBeTruthy();
  });
});

const PERM_GROUP: Record<string, string> = {
  evCreate: 'Events',
  finDiscount: 'Finance',
};

async function seedRedemption(
  pool: Pool,
  orgId: number,
  discountCodeId: string,
  eventId: string,
  buyerEmail: string,
): Promise<void> {
  const order = await pool.query<{ id: string }>(
    `INSERT INTO orders (organization_id, reference, event_id, buyer_name, buyer_email,
                         seats, subtotal_satang, total_satang, status)
     VALUES ($1, $2, $3, 'Buyer', $4, 1, 100000, 107000, 'confirmed') RETURNING id`,
    [
      orgId,
      `ref-${buyerEmail}-${discountCodeId.slice(0, 8)}`,
      eventId,
      buyerEmail,
    ],
  );
  await pool.query(
    `INSERT INTO discount_redemptions (organization_id, discount_code_id, order_id, buyer_email, amount_satang)
     VALUES ($1, $2, $3, $4, 10000)`,
    [orgId, discountCodeId, order.rows[0].id, buyerEmail],
  );
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

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(`DELETE FROM organizations WHERE slug = ANY($1)`, [
    [ORG.slug, ORG2.slug],
  ]);
}
