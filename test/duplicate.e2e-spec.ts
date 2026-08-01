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
const ORG = { slug: 'dup-e2e', name: 'Duplicate E2E' };
const ORG2 = { slug: 'dup-e2e-2', name: 'Duplicate E2E 2' };
const ADMIN = 'admin@dup-e2e.test'; // evCreate + evSpeakers
const LIMITED = 'staff@dup-e2e.test'; // regView only
const ADMIN2 = 'admin@dup-e2e-2.test';

interface Success<T> {
  data: T;
}
interface Event {
  id: string;
  name: string;
  slug: string;
  status: string;
}
interface Ticket {
  name: string;
  sold: number;
  total: number;
}
interface Sess {
  title: string;
  speakers: { id: string; name: string }[];
}

describe('Duplicate event (e2e — US-EVT-13)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let adminJwt: string;
  let srcId: string;
  let foreignEventId: string;

  const authHeader = (jwt: string) => ({ Authorization: `Bearer ${jwt}` });

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    await seedOrg(pool, ORG, [
      { email: ADMIN, roleName: 'Admin', grants: ['evCreate', 'evSpeakers'] },
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
    srcId = await buildRichEvent();
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
      .set(authHeader(jwt))
      .send({ name, type: 'Conference', startAt: '2026-09-01T02:00:00Z' });
    return (res.body as Success<{ id: string }>).data.id;
  }

  /** A source event with details, a sold ticket, a speaker, a session, and seating. */
  async function buildRichEvent(): Promise<string> {
    const id = await createEvent(adminJwt, 'Relaunch Me');
    await request(server)
      .patch(`/api/v1/events/${id}`)
      .set(authHeader(adminJwt))
      .send({ description: 'A great event', venueName: 'Grand Hall' })
      .expect(200);
    const ticket = await request(server)
      .post(`/api/v1/events/${id}/tickets`)
      .set(authHeader(adminJwt))
      .send({ name: 'VIP', priceSatang: 89000, total: 100 });
    const ticketId = (ticket.body as Success<{ id: string }>).data.id;
    await pool.query(`UPDATE ticket_types SET sold = 5 WHERE id = $1`, [
      ticketId,
    ]);

    const speaker = await request(server)
      .post(`/api/v1/events/${id}/speakers`)
      .set(authHeader(adminJwt))
      .send({ name: 'Ada' });
    const speakerId = (speaker.body as Success<{ id: string }>).data.id;
    await request(server)
      .post(`/api/v1/events/${id}/sessions`)
      .set(authHeader(adminJwt))
      .send({
        day: 1,
        startTime: '09:00',
        endTime: '10:00',
        title: 'Opening',
        type: 'Keynote',
        speakerIds: [speakerId],
      })
      .expect(201);
    await request(server)
      .put(`/api/v1/events/${id}/seating/reserved`)
      .set(authHeader(adminJwt))
      .send({ name: 'Hall', rows: 2, seatsPerRow: 3 })
      .expect(200);
    return id;
  }

  const duplicate = (id: string, jwt: string) =>
    request(server).post(`/api/v1/events/${id}/duplicate`).set(authHeader(jwt));

  it('creates a fresh "(Copy)" draft with a new id and slug', async () => {
    const res = await duplicate(srcId, adminJwt);
    expect(res.status).toBe(201);
    const copy = (res.body as Success<Event>).data;
    expect(copy.name).toBe('Relaunch Me (Copy)');
    expect(copy.status).toBe('draft');
    expect(copy.id).not.toBe(srcId);
    expect(copy.slug).not.toBe('relaunch-me');
  });

  it('copies tickets but resets sold to 0', async () => {
    const copyId = (await duplicate(srcId, adminJwt)).body as Success<Event>;
    const res = await request(server)
      .get(`/api/v1/events/${copyId.data.id}/tickets`)
      .set(authHeader(adminJwt));
    const tiers = (res.body as Success<Ticket[]>).data;
    expect(tiers).toHaveLength(1);
    expect(tiers[0]).toMatchObject({ name: 'VIP', total: 100, sold: 0 });
  });

  it('copies the agenda with speakers re-linked to the copied speakers', async () => {
    const copyId = ((await duplicate(srcId, adminJwt)).body as Success<Event>)
      .data.id;
    const speakers = await request(server)
      .get(`/api/v1/events/${copyId}/speakers`)
      .set(authHeader(adminJwt));
    const speakerNames = (
      speakers.body as Success<{ id: string; name: string }[]>
    ).data.map((s) => s.name);
    expect(speakerNames).toEqual(['Ada']);

    const sessions = await request(server)
      .get(`/api/v1/events/${copyId}/sessions`)
      .set(authHeader(adminJwt));
    const rows = (sessions.body as Success<Sess[]>).data;
    expect(rows).toHaveLength(1);
    expect(rows[0].speakers.map((s) => s.name)).toEqual(['Ada']);
  });

  it('copies the seat map', async () => {
    const copyId = ((await duplicate(srcId, adminJwt)).body as Success<Event>)
      .data.id;
    const res = await request(server)
      .get(`/api/v1/events/${copyId}/seating`)
      .set(authHeader(adminJwt));
    expect(
      (res.body as Success<{ seatMap: { totalSeats: number } | null }>).data
        .seatMap?.totalSeats,
    ).toBe(6);
  });

  it('forbids duplicating without evCreate (403)', async () => {
    const limitedJwt = await token(LIMITED, ORG.slug);
    await duplicate(srcId, limitedJwt).expect(403);
  });

  it("forbids duplicating another tenant's event (404)", async () => {
    await duplicate(foreignEventId, adminJwt).expect(404);
  });
});

const PERM_GROUP: Record<string, string> = {
  evCreate: 'Events',
  evSpeakers: 'Events',
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
