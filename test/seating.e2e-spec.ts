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
const ORG = { slug: 'seat-e2e', name: 'Seating E2E' };
const ORG2 = { slug: 'seat-e2e-2', name: 'Seating E2E 2' };
const ADMIN = 'admin@seat-e2e.test';
const LIMITED = 'staff@seat-e2e.test';
const ADMIN2 = 'admin@seat-e2e-2.test';

interface Success<T> {
  data: T;
}
interface Seating {
  seatingMode: string;
  isOnline: boolean;
  capacity: number | null;
  seatMap: {
    name: string;
    rows: number;
    seatsPerRow: number;
    totalSeats: number;
  } | null;
  ticketQuantity: number;
  seatShortfall: { totalSeats: number; ticketQuantity: number } | null;
  note: string | null;
}

describe('Seating (e2e — US-EVT-05)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let adminJwt: string;
  let foreignEventId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    await seedOrg(pool, ORG, [
      { email: ADMIN, roleName: 'Admin', grants: ['evCreate'] },
      { email: LIMITED, roleName: 'Organizer', grants: ['regView'] },
    ]);
    await seedOrg(pool, ORG2, [
      { email: ADMIN2, roleName: 'Admin', grants: ['evCreate'] },
    ]);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();
    server = app.getHttpServer() as Server;

    adminJwt = await token(ADMIN, ORG.slug);
    foreignEventId = await createEvent(await token(ADMIN2, ORG2.slug), 'Other');
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

  const reserved = (id: string, jwt: string, body: Record<string, unknown>) =>
    request(server)
      .put(`/api/v1/events/${id}/seating/reserved`)
      .set('Authorization', `Bearer ${jwt}`)
      .send(body);

  const getSeating = (id: string, jwt: string) =>
    request(server)
      .get(`/api/v1/events/${id}/seating`)
      .set('Authorization', `Bearer ${jwt}`);

  it('sets a general-admission headcount (no seat map)', async () => {
    const id = await createEvent(adminJwt, 'GA Event');
    const res = await request(server)
      .put(`/api/v1/events/${id}/seating/general`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ headcount: 250 });
    expect(res.status).toBe(200);
    const s = (res.body as Success<Seating>).data;
    expect(s).toMatchObject({
      seatingMode: 'ga',
      capacity: 250,
      seatMap: null,
    });
  });

  it('lays out reserved seating with rows × seats and a total count', async () => {
    const id = await createEvent(adminJwt, 'Reserved Event');
    const res = await reserved(id, adminJwt, {
      name: 'Grand Hall',
      rows: 4,
      seatsPerRow: 5,
    });
    expect(res.status).toBe(200);
    const s = (res.body as Success<Seating>).data;
    expect(s.seatingMode).toBe('reserved');
    expect(s.seatMap).toMatchObject({
      rows: 4,
      seatsPerRow: 5,
      totalSeats: 20,
    });

    // The 20 seats were actually generated.
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::int AS n FROM seats se
         JOIN seat_maps m ON m.id = se.seat_map_id WHERE m.event_id = $1`,
      [id],
    );
    expect(Number(rows[0].n)).toBe(20);
  });

  it('reconfiguring the same layout is idempotent (no duplicate seats)', async () => {
    const id = await createEvent(adminJwt, 'Idempotent Event');
    const seatCount = async (): Promise<number> => {
      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*)::int AS n FROM seats se
           JOIN seat_maps m ON m.id = se.seat_map_id WHERE m.event_id = $1`,
        [id],
      );
      return Number(rows[0].n);
    };
    await reserved(id, adminJwt, {
      name: 'Hall',
      rows: 2,
      seatsPerRow: 2,
    }).expect(200);
    expect(await seatCount()).toBe(4);
    // Re-applying the identical layout must not duplicate the 4 seats.
    await reserved(id, adminJwt, {
      name: 'Hall',
      rows: 2,
      seatsPerRow: 2,
    }).expect(200);
    expect(await seatCount()).toBe(4);
  });

  it('warns when the seat map is smaller than ticket quantities', async () => {
    const id = await createEvent(adminJwt, 'Shortfall Event');
    await reserved(id, adminJwt, {
      name: 'Hall',
      rows: 2,
      seatsPerRow: 3,
    }).expect(200); // 6 seats
    await request(server)
      .post(`/api/v1/events/${id}/tickets`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ name: 'GA', priceSatang: 10000, total: 50 })
      .expect(201);

    const res = await getSeating(id, adminJwt);
    expect((res.body as Success<Seating>).data.seatShortfall).toEqual({
      totalSeats: 6,
      ticketQuantity: 50,
    });
  });

  it('offers no seating for an online event', async () => {
    const id = await createEvent(adminJwt, 'Online Event');
    await request(server)
      .patch(`/api/v1/events/${id}`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ isOnline: true })
      .expect(200);

    await reserved(id, adminJwt, {
      name: 'Hall',
      rows: 2,
      seatsPerRow: 2,
    }).expect(422);
    const res = await getSeating(id, adminJwt);
    const s = (res.body as Success<Seating>).data;
    expect(s.isOnline).toBe(true);
    expect(s.seatMap).toBeNull();
    expect(s.note).toMatch(/join link/i);
  });

  it('never removes an already-sold seat when shrinking a published event (422)', async () => {
    const id = await createEvent(adminJwt, 'Published Reserved');
    await reserved(id, adminJwt, {
      name: 'Hall',
      rows: 3,
      seatsPerRow: 3,
    }).expect(200); // 9 seats

    // Simulate publication + a sold seat in the last row (position row 3, seat 1).
    await pool.query(`UPDATE events SET status = 'upcoming' WHERE id = $1`, [
      id,
    ]);
    await pool.query(
      `UPDATE seats SET status = 'sold'
         WHERE seat_map_id = (SELECT id FROM seat_maps WHERE event_id = $1)
           AND row_label = '3' AND seat_number = '1'`,
      [id],
    );

    // Shrinking to 2 rows would drop the sold seat — blocked.
    await reserved(id, adminJwt, {
      name: 'Hall',
      rows: 2,
      seatsPerRow: 3,
    }).expect(422);
    // Shrinking columns only (still keeps row 3 seat 1) is allowed.
    await reserved(id, adminJwt, {
      name: 'Hall',
      rows: 3,
      seatsPerRow: 2,
    }).expect(200);
  });

  it('forbids configuring seating without evCreate (403)', async () => {
    const id = await createEvent(adminJwt, 'Guarded Event');
    const limitedJwt = await token(LIMITED, ORG.slug);
    await reserved(id, limitedJwt, {
      name: 'Hall',
      rows: 2,
      seatsPerRow: 2,
    }).expect(403);
  });

  it("forbids configuring another tenant's event (404)", async () => {
    await reserved(foreignEventId, adminJwt, {
      name: 'Hall',
      rows: 2,
      seatsPerRow: 2,
    }).expect(404);
  });
});

const PERM_GROUP: Record<string, string> = {
  evCreate: 'Events',
  regView: 'Registrations',
};

async function seedOrg(
  pool: Pool,
  org: { slug: string; name: string },
  people: { email: string; roleName: string; grants: string[] }[],
): Promise<void> {
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
}

async function cleanup(pool: Pool): Promise<void> {
  const slugs = [ORG.slug, ORG2.slug];
  await pool.query(
    `DELETE FROM audit_events WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug = ANY($1))`,
    [slugs],
  );
  await pool.query(`DELETE FROM organizations WHERE slug = ANY($1)`, [slugs]);
}
