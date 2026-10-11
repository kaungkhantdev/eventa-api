process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://eventa:eventa@localhost:5432/eventa';
process.env.JWT_SECRET ??= 'test-secret-at-least-16-characters-long';
// One wrong guess short of the cap is cheap to exercise; the default (5) would
// make the "too many" case four indistinguishable requests of setup.
process.env.LOGIN_MAX_ATTEMPTS = '2';
// The cool-off is asserted by its own case and would otherwise 429 every other
// one of these, since they all ask for a code as the same member.
process.env.VERIFY_RESEND_COOLDOWN_SECONDS = '1';
// This suite asks the same member for a dozen codes, which is well past the
// per-window budget a real account gets. The budget is exercised in
// `resend-throttle.service.spec.ts`, where a window can be made to lapse
// without the suite waiting out a real one.
process.env.VERIFY_CODE_MAX_PER_WINDOW = '50';

import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { buildValidationPipe } from '../src/common/http/validation';
import { IDENTITY_PHONE_VERIFICATION_REQUESTED } from '../src/modules/users/events/phone-verification-requested.event';
import { listenOnLoopback } from './support/loopback';

const PASSWORD = 'correct horse battery staple';
const ORG = { slug: 'phone-e2e', name: 'Phone E2E' };
const ME = 'me@phone-e2e.test';

const TYPED = '081 234 5678';
const NORMALISED = '+66812345678';
const SECOND = '+66899999999';
const MAX_ATTEMPTS = 2;

interface Success<T> {
  data: T;
}
interface Profile {
  phone: string | null;
  pendingPhone: string | null;
  phoneVerified: boolean;
}
interface Preference {
  category: string;
  smsEnabled: boolean;
  smsAvailable: boolean;
}

/**
 * Confirming a changed phone number by code (e2e — US-DISC-11 AC3).
 *
 * The criterion is "Given I change my phone, when I save, then I must confirm
 * it by code before it's used for texts", and "used for texts" is the part
 * with teeth: the last case here checks that SMS alerts cannot be switched on
 * against a number that has not come back confirmed, because that endpoint is
 * the other door onto the same mistake.
 */
describe('Phone confirmation (e2e — US-DISC-11 AC3)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let jwt: string;

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
    await listenOnLoopback(app);
    server = app.getHttpServer() as Server;

    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: ME, password: PASSWORD, orgSlug: ORG.slug });
    jwt = (res.body as Success<{ accessToken: string }>).data.accessToken;
  }, 30000);

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  const auth = <T extends request.Test>(r: T) =>
    r.set('Authorization', `Bearer ${jwt}`);
  const getProfile = () => auth(request(server).get('/api/v1/me/profile'));
  const requestCode = (phone: string) =>
    auth(request(server).post('/api/v1/me/profile/phone')).send({ phone });
  const confirmCode = (code: string) =>
    auth(request(server).post('/api/v1/me/profile/phone/confirm')).send({
      code,
    });
  const removePhone = () =>
    auth(request(server).delete('/api/v1/me/profile/phone'));
  const setSms = (smsEnabled: boolean) =>
    auth(
      request(server).patch('/api/v1/me/notification-preferences/payment'),
    ).send({ smsEnabled });

  /** The code the worker would have texted, straight off the outbox row. */
  const lastTexted = async (): Promise<{ phone: string; code: string }> => {
    const { rows } = await pool.query<{ phone: string; code: string }>(
      `SELECT payload->>'phone' phone, payload->>'code' code
         FROM outbox_events WHERE routing_key = $1
        ORDER BY id DESC LIMIT 1`,
      [IDENTITY_PHONE_VERIFICATION_REQUESTED],
    );
    return rows[0];
  };

  /** Lets the cool-off lapse between the cases that each ask for a code. */
  const pastCooldown = () => new Promise((r) => setTimeout(r, 1100));

  beforeEach(pastCooldown);

  it('holds the new number, texts a code, and leaves nothing on file in use', async () => {
    const res = await requestCode(TYPED);
    expect(res.status).toBe(202);
    expect((res.body as Success<Profile>).data).toMatchObject({
      phone: null,
      pendingPhone: NORMALISED,
      phoneVerified: false,
    });

    // normalised to the one shape an SMS provider accepts
    const sent = await lastTexted();
    expect(sent.phone).toBe(NORMALISED);
    expect(sent.code).toMatch(/^\d{6}$/);
  });

  it('never stores the code it sent, only a digest of it', async () => {
    await requestCode(TYPED);
    const { code } = await lastTexted();
    const { rows } = await pool.query<{ hash: string; attempts: number }>(
      `SELECT phone_code_hash hash, phone_code_attempts attempts
         FROM users WHERE email = $1`,
      [ME],
    );
    expect(rows[0].hash).toHaveLength(64);
    expect(rows[0].hash).not.toContain(code);
    expect(rows[0].attempts).toBe(0);
  });

  it('refuses a number that cannot receive a text (422)', async () => {
    const res = await requestCode('021234567'); // a Bangkok landline
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      errors: [{ field: 'phone' }],
    });
  });

  it('refuses a wrong code, and does not promote the number', async () => {
    await requestCode(TYPED);
    const res = await confirmCode('000000');
    expect(res.status).toBe(422);
    expect((await getProfile()).body).toMatchObject({
      data: { phone: null, pendingPhone: NORMALISED, phoneVerified: false },
    });
  });

  it('kills the code once the attempts run out, and says so distinctly', async () => {
    await requestCode(TYPED);
    const { code } = await lastTexted();
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      expect((await confirmCode(wrong)).status).toBe(422);
    }
    const spent = await confirmCode(wrong);
    expect(spent.body).toMatchObject({ code: 'PHONE_CODE_EXPIRED' });

    // and the right code no longer works either — the code is gone, not locked
    const afterwards = await confirmCode(code);
    expect(afterwards.body).toMatchObject({ code: 'PHONE_CODE_EXPIRED' });
  });

  it('asking again replaces the code in flight', async () => {
    await requestCode(TYPED);
    const first = await lastTexted();
    await pastCooldown();
    await requestCode(SECOND);
    const second = await lastTexted();

    expect(second.phone).toBe(SECOND);
    expect((await getProfile()).body).toMatchObject({
      data: { pendingPhone: SECOND },
    });
    // the first code was for a number that is no longer on offer
    const stale = await confirmCode(first.code);
    expect(stale.status).toBe(422);
  });

  it('refuses a second code inside the cool-off (429)', async () => {
    await requestCode(TYPED);
    const again = await requestCode(TYPED);
    expect(again.status).toBe(429);
  });

  it('promotes the number once the code comes back, and only then', async () => {
    await requestCode(TYPED);
    const { code } = await lastTexted();

    // before: nothing to text, so the SMS switch is unavailable and refused
    const before = (
      await auth(request(server).get('/api/v1/me/notification-preferences'))
    ).body as Success<Preference[]>;
    expect(before.data.every((p) => !p.smsAvailable)).toBe(true);
    expect((await setSms(true)).status).toBe(422);

    const confirmed = await confirmCode(code);
    expect(confirmed.status).toBe(200);
    expect((confirmed.body as Success<Profile>).data).toMatchObject({
      phone: NORMALISED,
      pendingPhone: null,
      phoneVerified: true,
    });

    // after: the number is textable, so the switch works
    const after = (
      await auth(request(server).get('/api/v1/me/notification-preferences'))
    ).body as Success<Preference[]>;
    expect(after.data.every((p) => p.smsAvailable)).toBe(true);
    expect((await setSms(true)).status).toBe(200);

    // the challenge left nothing behind
    const { rows } = await pool.query<{
      hash: string | null;
      pending: string | null;
      attempts: number;
      verified: Date | null;
    }>(
      `SELECT phone_code_hash hash, pending_phone pending,
              phone_code_attempts attempts, phone_verified_at verified
         FROM users WHERE email = $1`,
      [ME],
    );
    expect(rows[0]).toMatchObject({ hash: null, pending: null, attempts: 0 });
    expect(rows[0].verified).not.toBeNull();
  });

  it('the number in use keeps working while a change is unconfirmed', async () => {
    await requestCode(SECOND);
    expect((await getProfile()).body).toMatchObject({
      data: {
        phone: NORMALISED, // still the confirmed one from the case above
        pendingPhone: SECOND,
        phoneVerified: true, // the number being texted is still a proven one
      },
    });
  });

  it('refuses re-requesting the number already confirmed (422)', async () => {
    const res = await requestCode(NORMALISED);
    expect(res.status).toBe(422);
  });

  it('removing the number clears the change in flight with it', async () => {
    const res = await removePhone();
    expect(res.status).toBe(200);
    expect((res.body as Success<Profile>).data).toMatchObject({
      phone: null,
      pendingPhone: null,
      phoneVerified: false,
    });
    const { rows } = await pool.query<{ hash: string | null }>(
      `SELECT phone_code_hash hash FROM users WHERE email = $1`,
      [ME],
    );
    expect(rows[0].hash).toBeNull();
  });

  /**
   * The migration deliberately backfills nothing, so numbers typed before this
   * story was built sit in `phone` unconfirmed. Those accounts must be able to
   * confirm the number they already have, or the only way out would be to
   * retype it to something else and back.
   */
  it('lets a number on file but never confirmed be confirmed in place', async () => {
    await pool.query(
      `UPDATE users SET phone = $2, phone_verified_at = NULL WHERE email = $1`,
      [ME, NORMALISED],
    );
    expect((await requestCode(NORMALISED)).status).toBe(202);
    const { code } = await lastTexted();
    const confirmed = await confirmCode(code);
    expect((confirmed.body as Success<Profile>).data).toMatchObject({
      phone: NORMALISED,
      phoneVerified: true,
    });
  });

  it('requires authentication (401)', async () => {
    const res = await request(server)
      .post('/api/v1/me/profile/phone')
      .send({ phone: TYPED });
    expect(res.status).toBe(401);
  });
});

async function seed(pool: Pool): Promise<void> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
    [ORG.name, ORG.slug],
  );
  const orgId = Number(res.rows[0].id);
  await pool.query(
    `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
     VALUES ($1, 'Somchai', $2, 'admin', 'Active', $3)`,
    [orgId, ME, await hash(PASSWORD)],
  );
}

async function cleanup(pool: Pool): Promise<void> {
  const org = `(SELECT id FROM organizations WHERE slug = $1)`;
  await pool.query(
    `DELETE FROM notification_preferences WHERE organization_id IN ${org}`,
    [ORG.slug],
  );
  await pool.query(
    `DELETE FROM outbox_events WHERE organization_id IN ${org}`,
    [ORG.slug],
  );
  // Written by eventa-worker if the relay is up while the suite runs; the FK is
  // ON DELETE RESTRICT, so these have to go before the organization can.
  await pool.query(`DELETE FROM audit_events WHERE organization_id IN ${org}`, [
    ORG.slug,
  ]);
  await pool.query(`DELETE FROM organizations WHERE slug = $1`, [ORG.slug]);
}
