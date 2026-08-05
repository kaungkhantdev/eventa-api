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
import { generateTotp } from '../src/common/crypto/totp';
import { buildValidationPipe } from '../src/common/http/validation';
import { OutboxPort } from '../src/modules/platform/outbox.port';

const PASSWORD = 'correct horse battery staple';
/** Unique per run — deliberate failures leave throttle strikes in Redis. */
const RUN = Date.now();
const ANAN = `anan-${RUN}@delacct.test`; // holds an upcoming paid ticket
const BOON = `boon-${RUN}@delacct.test`; // enrols 2FA before deleting
const DARA = `dara-${RUN}@delacct.test`; // hammers the wrong password
const EKKA = `ekka-${RUN}@delacct.test`; // deletion hits a broken outbox
const ORG_ADMIN = `admin-${RUN}@delacct.test`; // workspace member — refused
const ORG_SLUG = `delacct-${RUN}`;
const TICKET_PRICE_SATANG = 188_000; // ฿1,880 — TC-DISC-27's non-refundable ticket
const RUNNING_PRICE_SATANG = 50_000; // a multi-day event that already started
const MAX_ATTEMPTS = 5; // LOGIN_MAX_ATTEMPTS default — shared by the delete realm

interface Success<T> {
  data: T;
}
interface WarningBody {
  requiresTwoFactorCode: boolean;
  upcomingPaidOrders: { reference: string; totalSatang: number }[];
  totalAtRiskSatang: number;
}

describe('Delete my account (e2e — US-DISC-14)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    await seed(pool);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();
    server = app.getHttpServer() as Server;
  }, 30000);

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  const login = async (
    email: string,
    extra: Record<string, unknown> = {},
  ): Promise<{ status: number; accessToken?: string }> => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, persona: 'attendee', ...extra });
    const body = res.body as Success<{ accessToken?: string }>;
    return { status: res.status, accessToken: body.data?.accessToken };
  };

  const del = (jwt: string, body: Record<string, unknown>) =>
    request(server)
      .delete('/api/v1/me/account')
      .set('Authorization', `Bearer ${jwt}`)
      .send(body);

  const outboxCount = async (email: string): Promise<number> => {
    const res = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM outbox_events
       WHERE routing_key = 'identity.account_deletion_requested'
         AND payload ->> 'email' = $1`,
      [email],
    );
    return Number(res.rows[0].n);
  };

  it('the warning lists ONLY upcoming settled money — refunds, pending, free, past and voided orders stay out', async () => {
    const { accessToken } = await login(ANAN);
    const res = await request(server)
      .get('/api/v1/me/account/deletion')
      .set('Authorization', `Bearer ${accessToken as string}`);
    expect(res.status).toBe(200);
    const body = (res.body as Success<WarningBody>).data;
    expect(body.requiresTwoFactorCode).toBe(false);
    // Seeded alongside: a refunded order, a pending-payment order, a free
    // order, an order on a past event, and a soft-deleted order — none may
    // appear. The multi-day event that already STARTED but has not ended must.
    expect(body.upcomingPaidOrders).toHaveLength(2);
    const totals = body.upcomingPaidOrders.map((o) => o.totalSatang);
    expect(totals).toEqual([RUNNING_PRICE_SATANG, TICKET_PRICE_SATANG]);
    expect(body.totalAtRiskSatang).toBe(
      RUNNING_PRICE_SATANG + TICKET_PRICE_SATANG,
    );
  });

  it('without the explicit confirmation phrase, nothing happens', async () => {
    const { accessToken } = await login(ANAN);
    const res = await del(accessToken as string, {
      confirm: 'yes please',
      password: PASSWORD,
    });
    expect([400, 422]).toContain(res.status);
    expect(await outboxCount(ANAN)).toBe(0);
  });

  it('a wrong password aborts — still signed in, data intact, no email queued', async () => {
    const { accessToken } = await login(ANAN);
    const res = await del(accessToken as string, {
      confirm: 'DELETE',
      password: 'not my password',
    });
    expect(res.status).toBe(403);
    const me = await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken as string}`);
    expect(me.status).toBe(200);
    const row = await pool.query<{ deleted_at: Date | null }>(
      `SELECT deleted_at FROM users WHERE email = $1`,
      [ANAN],
    );
    expect(row.rows[0].deleted_at).toBeNull();
    expect(await outboxCount(ANAN)).toBe(0);
  });

  it('confirmed + re-verified: soft-deleted, signed out everywhere, email queued once', async () => {
    const { accessToken } = await login(ANAN);
    const res = await del(accessToken as string, {
      confirm: 'DELETE',
      password: PASSWORD,
    });
    expect(res.status).toBe(200);

    const user = await pool.query<{ id: string; deleted_at: Date | null }>(
      `SELECT id, deleted_at FROM users WHERE email = $1`,
      [ANAN],
    );
    expect(user.rows[0].deleted_at).not.toBeNull();
    const live = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM auth_sessions
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [user.rows[0].id],
    );
    expect(Number(live.rows[0].n)).toBe(0);
    expect(await outboxCount(ANAN)).toBe(1);

    // The credentials no longer buy a session.
    const gone = await login(ANAN);
    expect(gone.status).toBe(401);
  });

  it('with 2FA enrolled, deletion demands the code and honours it', async () => {
    const { accessToken } = await login(BOON);
    const jwt = accessToken as string;
    const started = await request(server)
      .post('/api/v1/me/two-factor/start')
      .set('Authorization', `Bearer ${jwt}`);
    const secret = (started.body as Success<{ secret: string }>).data.secret;
    await request(server)
      .post('/api/v1/me/two-factor/confirm')
      .set('Authorization', `Bearer ${jwt}`)
      .send({ code: generateTotp(secret) });

    const noCode = await del(jwt, { confirm: 'DELETE', password: PASSWORD });
    expect(noCode.status).toBe(422);
    const badCode = await del(jwt, {
      confirm: 'DELETE',
      password: PASSWORD,
      code: '000000',
    });
    expect(badCode.status).toBe(403);
    expect(await outboxCount(BOON)).toBe(0);

    const goodCode = await del(jwt, {
      confirm: 'DELETE',
      password: PASSWORD,
      code: generateTotp(secret),
    });
    expect(goodCode.status).toBe(200);
    expect(await outboxCount(BOON)).toBe(1);
  });

  it('re-verification locks after repeated wrong passwords — like sign-in does', async () => {
    const { accessToken } = await login(DARA);
    const jwt = accessToken as string;
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      const res = await del(jwt, {
        confirm: 'DELETE',
        password: 'wrong-guess',
      });
      expect(res.status).toBe(403);
    }
    // Even the CORRECT password is refused during the cool-off.
    const locked = await del(jwt, { confirm: 'DELETE', password: PASSWORD });
    expect(locked.status).toBe(429);
    const row = await pool.query<{ deleted_at: Date | null }>(
      `SELECT deleted_at FROM users WHERE email = $1`,
      [DARA],
    );
    expect(row.rows[0].deleted_at).toBeNull();
  });

  describe('when the outbox write fails mid-transaction', () => {
    let faultApp: INestApplication;
    let faultServer: Server;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(OutboxPort)
        .useValue({
          enqueue: () => Promise.resolve(),
          enqueueIn: () => Promise.reject(new Error('outbox unavailable')),
        })
        .compile();
      faultApp = moduleRef.createNestApplication();
      faultApp.setGlobalPrefix('api/v1');
      faultApp.useGlobalPipes(buildValidationPipe());
      await faultApp.init();
      faultServer = faultApp.getHttpServer() as Server;
    }, 30000);

    afterAll(async () => {
      await faultApp.close();
    });

    it('rolls back the soft delete AND the sign-out — one transaction or nothing', async () => {
      const { accessToken } = await login(EKKA);
      const res = await request(faultServer)
        .delete('/api/v1/me/account')
        .set('Authorization', `Bearer ${accessToken as string}`)
        .send({ confirm: 'DELETE', password: PASSWORD });
      expect(res.status).toBe(500);

      const row = await pool.query<{ deleted_at: Date | null }>(
        `SELECT deleted_at FROM users WHERE email = $1`,
        [EKKA],
      );
      expect(row.rows[0].deleted_at).toBeNull();
      const live = await pool.query<{ n: string }>(
        `SELECT count(*) AS n FROM auth_sessions
         WHERE user_id = (SELECT id FROM users WHERE email = $1)
           AND revoked_at IS NULL`,
        [EKKA],
      );
      expect(Number(live.rows[0].n)).toBeGreaterThanOrEqual(1);
      expect(await outboxCount(EKKA)).toBe(0);
    });
  });

  it('a workspace member is refused — this door is for attendees', async () => {
    const res = await request(server).post('/api/v1/auth/login').send({
      email: ORG_ADMIN,
      password: PASSWORD,
      persona: 'admin',
      orgSlug: ORG_SLUG,
    });
    expect(res.status).toBe(200);
    const jwt = (res.body as Success<{ accessToken: string }>).data.accessToken;
    const refused = await del(jwt, { confirm: 'DELETE', password: PASSWORD });
    expect(refused.status).toBe(403);
    const row = await pool.query<{ deleted_at: Date | null }>(
      `SELECT deleted_at FROM users WHERE email = $1`,
      [ORG_ADMIN],
    );
    expect(row.rows[0].deleted_at).toBeNull();
  });
});

async function seed(pool: Pool): Promise<void> {
  const passwordHash = await hash(PASSWORD);
  for (const email of [ANAN, BOON, DARA, EKKA]) {
    await pool.query(
      `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
       SELECT id, 'Attendee', $1, 'attendee', 'Active', $2
       FROM organizations WHERE slug = 'eventa'`,
      [email, passwordHash],
    );
  }
  const org = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug, vat_rate, service_fee_rate)
     VALUES ('Delacct Org', $1, 0.0700, 0.0500) RETURNING id`,
    [ORG_SLUG],
  );
  const orgId = Number(org.rows[0].id);
  await pool.query(
    `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
     VALUES ($1, 'Org Admin', $2, 'admin', 'Active', $3)`,
    [orgId, ORG_ADMIN, passwordHash],
  );

  // Three events: 14 days out · already over · started but still running.
  const future = await seedEvent(
    pool,
    orgId,
    'summit',
    `now() + interval '14 days'`,
    'NULL',
  );
  const past = await seedEvent(
    pool,
    orgId,
    'gone',
    `now() - interval '10 days'`,
    `now() - interval '9 days'`,
  );
  const running = await seedEvent(
    pool,
    orgId,
    'live',
    `now() - interval '1 day'`,
    `now() + interval '1 day'`,
  );

  // The two orders the warning MUST list…
  await seedOrder(
    pool,
    orgId,
    future,
    ANAN,
    'KEEP-FUT',
    'paid',
    TICKET_PRICE_SATANG,
  );
  await seedOrder(
    pool,
    orgId,
    running,
    ANAN,
    'KEEP-RUN',
    'paid',
    RUNNING_PRICE_SATANG,
  );
  // …and the five it must NOT: refunded, unpaid, free, past, soft-deleted.
  await seedOrder(pool, orgId, future, ANAN, 'SKIP-REF', 'refunded', 77_000);
  await seedOrder(pool, orgId, future, ANAN, 'SKIP-PEND', 'pending', 88_000);
  await seedOrder(pool, orgId, future, ANAN, 'SKIP-FREE', 'paid', 0);
  await seedOrder(pool, orgId, past, ANAN, 'SKIP-PAST', 'paid', 99_000);
  await seedOrder(pool, orgId, future, ANAN, 'SKIP-DEL', 'paid', 66_000, true);
}

async function seedEvent(
  pool: Pool,
  orgId: number,
  suffix: string,
  startSql: string,
  endSql: string,
): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO events (organization_id, slug, name, type, bucket, status, visibility,
                         start_at, end_at, timezone, organizer_name, published_at)
     VALUES ($1, $2, 'Delacct ${suffix}', 'Conference', 'active', 'upcoming', 'public',
             ${startSql}, ${endSql}, 'Asia/Bangkok', 'Delacct', now())
     RETURNING id`,
    [orgId, `${ORG_SLUG}-${suffix}`],
  );
  return res.rows[0].id;
}

async function seedOrder(
  pool: Pool,
  orgId: number,
  eventId: string,
  email: string,
  ref: string,
  paymentStatus: string,
  totalSatang: number,
  softDeleted = false,
): Promise<void> {
  const vat = Math.round((totalSatang * 7) / 107);
  await pool.query(
    `INSERT INTO orders (organization_id, reference, event_id, buyer_name, buyer_email,
                         status, payment_status, seats, subtotal_satang, vat_amount_satang,
                         total_satang, deleted_at)
     VALUES ($1, $2, $3, 'Anan', $4, 'confirmed', $5::payment_status, 1, $6, $7, $6,
             CASE WHEN $8 THEN now() ELSE NULL END)`,
    [
      orgId,
      `${ref}-${RUN}`,
      eventId,
      email,
      paymentStatus,
      totalSatang,
      vat,
      softDeleted,
    ],
  );
}

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM outbox_events WHERE payload ->> 'email' LIKE '%@delacct.test'`,
  );
  await pool.query(
    `DELETE FROM orders WHERE buyer_email LIKE '%@delacct.test'`,
  );
  await pool.query(
    `DELETE FROM events WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug LIKE 'delacct-%')`,
  );
  await pool.query(`DELETE FROM users WHERE email LIKE '%@delacct.test'`);
  await pool.query(`DELETE FROM organizations WHERE slug LIKE 'delacct-%'`);
}
