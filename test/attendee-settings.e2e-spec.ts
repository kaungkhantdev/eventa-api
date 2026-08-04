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
const NEW_PASSWORD = 'a brand new longer password 9';
/** Unique per run — deliberate login failures leave throttle strikes in Redis. */
const RUN = Date.now();
const ANAN = `anan-${RUN}@att-settings.test`;

interface Success<T> {
  data: T;
}
interface Pref {
  category: string;
  emailEnabled: boolean;
  smsEnabled: boolean;
}

describe('Attendee settings (e2e — US-DISC-12)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let token: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    await pool.query(
      `INSERT INTO users (organization_id, name, email, persona, status, password_hash, phone)
       SELECT id, 'Anan', $1, 'attendee', 'Active', $2, '+66812345678'
       FROM organizations WHERE slug = 'eventa'`,
      [ANAN, await hash(PASSWORD)],
    );

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();
    server = app.getHttpServer() as Server;
    token = await signIn(PASSWORD);
  }, 30000);

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  async function signIn(password: string): Promise<string> {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: ANAN, password, persona: 'attendee' });
    expect(res.status).toBe(200);
    return (res.body as Success<{ accessToken: string }>).data.accessToken;
  }

  const get = (path: string) =>
    request(server)
      .get(`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`);
  const patch = (path: string, body: object) =>
    request(server)
      .patch(`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  const post = (path: string, body: object, jwt = token) =>
    request(server)
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${jwt}`)
      .send(body);

  describe('notification toggles', () => {
    it('offers an attendee exactly their topics: reminders and marketing', async () => {
      const res = await get('/me/notification-preferences');
      expect(res.status).toBe(200);
      const prefs = (res.body as Success<Pref[]>).data;
      expect(prefs.map((p) => p.category)).toEqual(['reminder', 'marketing']);
      // Never an organizer topic like payout or sales.
    });

    it('saves switching marketing off, and it stays off', async () => {
      const res = await patch('/me/notification-preferences/marketing', {
        emailEnabled: false,
      });
      expect(res.status).toBe(200);
      const again = (
        (await get('/me/notification-preferences')).body as Success<Pref[]>
      ).data;
      expect(again.find((p) => p.category === 'marketing')?.emailEnabled).toBe(
        false,
      );
      // …while event reminders are untouched (transactional mail has no toggle at all).
      expect(again.find((p) => p.category === 'reminder')?.emailEnabled).toBe(
        true,
      );
    });

    it('records WHEN the marketing choice was made (PDPA)', async () => {
      const { rows } = await pool.query<{ updated_at: Date }>(
        `SELECT np.updated_at FROM notification_preferences np
         JOIN users u ON u.id = np.user_id
         WHERE u.email = $1 AND np.category = 'marketing'`,
        [ANAN],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].updated_at).toBeInstanceOf(Date);
    });

    it('turns SMS alerts on for reminders — a phone is on file', async () => {
      const res = await patch('/me/notification-preferences/reminder', {
        smsEnabled: true,
      });
      expect(res.status).toBe(200);
      const prefs = (res.body as Success<Pref[]>).data;
      expect(prefs.find((p) => p.category === 'reminder')?.smsEnabled).toBe(
        true,
      );
    });

    it("refuses a topic that isn't an attendee's to toggle", async () => {
      const res = await patch('/me/notification-preferences/payout', {
        emailEnabled: false,
      });
      expect(res.status).toBe(422);
    });
  });

  describe('display preferences', () => {
    it('saves language, timezone and display currency', async () => {
      const res = await patch('/me/profile', {
        locale: 'th',
        timezone: 'Asia/Bangkok',
        displayCurrency: 'USD',
      });
      expect(res.status).toBe(200);
      const profile = (
        res.body as Success<{
          locale: string;
          timezone: string;
          displayCurrency: string;
        }>
      ).data;
      expect(profile).toMatchObject({
        locale: 'th',
        timezone: 'Asia/Bangkok',
        displayCurrency: 'USD',
      });
    });

    it('rejects a currency that is not a 3-letter code', async () => {
      expect(
        (await patch('/me/profile', { displayCurrency: 'DOLLARS' })).status,
      ).toBe(400);
    });
  });

  describe('changing the password', () => {
    it('refuses a wrong current password, and nothing changes', async () => {
      const res = await post('/auth/change-password', {
        currentPassword: 'not-my-password',
        newPassword: NEW_PASSWORD,
      });
      expect([400, 401, 403, 422]).toContain(res.status);
      // The old password still signs in.
      await signIn(PASSWORD);
    });

    it('changes it with the correct current password', async () => {
      const res = await post('/auth/change-password', {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      });
      expect(res.status).toBe(200);
      // New works; old is dead.
      token = await signIn(NEW_PASSWORD);
      const old = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: ANAN, password: PASSWORD, persona: 'attendee' });
      expect(old.status).toBe(401);
    });

    it('can sign out every other session afterwards', async () => {
      const other = await signIn(NEW_PASSWORD); // a second device
      const res = await post('/me/sessions/revoke-others', {});
      expect(res.status).toBe(200);
      void other; // its refresh session is revoked server-side
    });
  });
});

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM outbox_events WHERE aggregate_id IN
       (SELECT id::text FROM users WHERE email LIKE '%@att-settings.test')`,
  );
  await pool.query(`DELETE FROM users WHERE email LIKE '%@att-settings.test'`);
}
