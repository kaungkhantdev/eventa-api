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
const ORG = { slug: 'ses-e2e', name: 'Sessions E2E' };
const ORG2 = { slug: 'ses-e2e-2', name: 'Sessions E2E 2' };
const ADMIN = 'admin@ses-e2e.test';
const LIMITED = 'staff@ses-e2e.test';
const ADMIN2 = 'admin@ses-e2e-2.test';

interface Success<T> {
  data: T;
}
interface SessionSpeaker {
  id: string;
  name: string;
}
interface Session {
  id: string;
  title: string;
  day: number;
  startTime: string;
  endTime: string | null;
  room: string | null;
  type: string;
  color: string;
  description: string | null;
  speakers: SessionSpeaker[];
  warning: string | null;
  version: number;
}

describe('Sessions / agenda (e2e — US-EVT-09)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let adminJwt: string;
  let eventId: string;
  let foreignEventId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    await seedOrg(pool, ORG, [
      { email: ADMIN, roleName: 'Admin', grants: ['evSpeakers', 'evCreate'] },
      { email: LIMITED, roleName: 'Organizer', grants: ['evCreate'] },
    ]);
    await seedOrg(pool, ORG2, [
      { email: ADMIN2, roleName: 'Admin', grants: ['evSpeakers', 'evCreate'] },
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
    eventId = await createEvent(adminJwt, 'Agenda Event');
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

  const addSession = (jwt: string, body: Record<string, unknown>) =>
    request(server)
      .post(`/api/v1/events/${eventId}/sessions`)
      .set('Authorization', `Bearer ${jwt}`)
      .send(body);

  const addSpeaker = async (name: string): Promise<string> => {
    const res = await request(server)
      .post(`/api/v1/events/${eventId}/speakers`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ name });
    return (res.body as Success<{ id: string }>).data.id;
  };

  it('adds a session and requires a title', async () => {
    const ok = await addSession(adminJwt, {
      day: 1,
      startTime: '09:00',
      endTime: '10:00',
      title: 'Opening Keynote',
      type: 'Keynote',
      room: 'Main Hall',
    });
    expect(ok.status).toBe(201);
    expect((ok.body as Success<Session>).data.warning).toBeNull();

    await addSession(adminJwt, {
      day: 1,
      startTime: '09:00',
      title: '   ',
      type: 'Talk',
    }).expect(422);
  });

  it('rejects an end time not after the start (422)', async () => {
    await addSession(adminJwt, {
      day: 1,
      startTime: '11:00',
      endTime: '11:00',
      title: 'Zero',
      type: 'Talk',
    }).expect(422);
  });

  it('BLOCKS a double-booked room, naming the room and the time (US-PROG-05)', async () => {
    const res = await addSession(adminJwt, {
      day: 1,
      startTime: '09:30',
      endTime: '10:30',
      title: 'Clashing Talk',
      type: 'Talk',
      room: 'Main Hall',
    });
    expect(res.status).toBe(409);
    const { message } = res.body as { message: string };
    expect(message).toMatch(/Main Hall/);
    expect(message).toMatch(/Opening Keynote/);
    expect(message).toMatch(/09:00/);
  });

  it('allows parallel tracks in a different room at the same time', async () => {
    const res = await addSession(adminJwt, {
      day: 1,
      startTime: '09:30',
      endTime: '10:30',
      title: 'Parallel Track',
      type: 'Talk',
      room: 'Room B',
    });
    expect(res.status).toBe(201);
    expect((res.body as Success<Session>).data.warning).toBeNull();
  });

  it('warns once about a double-booked speaker, then saves on confirm (US-PROG-05)', async () => {
    const suda = await addSpeaker('Dr Suda');
    const first = await addSession(adminJwt, {
      day: 4,
      startTime: '09:00',
      endTime: '10:00',
      title: 'Suda Keynote',
      type: 'Keynote',
      room: 'Hall A',
      speakerIds: [suda],
    });
    expect(first.status).toBe(201);

    // Same speaker, overlapping time, DIFFERENT room — a judgement call.
    const overlapping = {
      day: 4,
      startTime: '09:30',
      endTime: '10:30',
      title: 'Suda Panel',
      type: 'Panel',
      room: 'Hall B',
      speakerIds: [suda],
    };
    const refused = await addSession(adminJwt, overlapping);
    expect(refused.status).toBe(409);
    expect((refused.body as { message: string }).message).toMatch(/Dr Suda/);

    const confirmed = await addSession(adminJwt, {
      ...overlapping,
      confirmSpeakerClash: true,
    });
    expect(confirmed.status).toBe(201);
    expect((confirmed.body as Success<Session>).data.warning).toMatch(
      /Dr Suda/,
    );
  });

  it('links speakers and returns them; rejects a foreign speaker id', async () => {
    const ada = await addSpeaker('Ada');
    const res = await addSession(adminJwt, {
      day: 2,
      startTime: '14:00',
      endTime: '15:00',
      title: 'Panel',
      type: 'Panel',
      room: 'Main Hall',
      speakerIds: [ada],
    });
    expect(res.status).toBe(201);
    expect(
      (res.body as Success<Session>).data.speakers.map((s) => s.name),
    ).toEqual(['Ada']);

    // A real speaker belonging to ANOTHER tenant's event must not be linkable —
    // exercises the org+event scoping in validSpeakerIds (not just "id missing").
    const admin2Jwt = await token(ADMIN2, ORG2.slug);
    const foreignSpeaker = await request(server)
      .post(`/api/v1/events/${foreignEventId}/speakers`)
      .set('Authorization', `Bearer ${admin2Jwt}`)
      .send({ name: 'Foreign Star' });
    const foreignSpeakerId = (foreignSpeaker.body as Success<{ id: string }>)
      .data.id;

    await addSession(adminJwt, {
      day: 2,
      startTime: '16:00',
      title: 'Bad Panel',
      type: 'Panel',
      speakerIds: [foreignSpeakerId],
    }).expect(422);
  });

  it('lists sessions in agenda order (day, then start time)', async () => {
    const res = await request(server)
      .get(`/api/v1/events/${eventId}/sessions`)
      .set('Authorization', `Bearer ${adminJwt}`);
    expect(res.status).toBe(200);
    const rows = (res.body as Success<Session[]>).data;
    const keyed = rows.map((r) => `${r.day}:${r.startTime}`);
    const sorted = [...keyed].sort();
    expect(keyed).toEqual(sorted);
    // Day 1 sessions precede day 2.
    expect(rows[0].day).toBe(1);
  });

  it('removes a session', async () => {
    const created = await addSession(adminJwt, {
      day: 3,
      startTime: '10:00',
      title: 'To Remove',
      type: 'Talk',
    });
    const id = (created.body as Success<Session>).data.id;
    await request(server)
      .delete(`/api/v1/events/${eventId}/sessions/${id}?confirm=true`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .expect(200);
  });

  it('refuses to remove a session without an explicit confirm (US-PROG-04)', async () => {
    const created = await addSession(adminJwt, {
      day: 3,
      startTime: '15:00',
      title: 'Needs Confirming',
      type: 'Talk',
    });
    const id = (created.body as Success<Session>).data.id;
    const refused = await request(server)
      .delete(`/api/v1/events/${eventId}/sessions/${id}`)
      .set('Authorization', `Bearer ${adminJwt}`);
    expect(refused.status).toBe(409);
    expect((refused.body as { message: string }).message).toMatch(
      /will NOT notify/i,
    );
    // …and it is still there.
    const list = await request(server)
      .get(`/api/v1/events/${eventId}/sessions`)
      .set('Authorization', `Bearer ${adminJwt}`);
    expect(
      (list.body as Success<Session[]>).data.some((x) => x.id === id),
    ).toBe(true);
  });

  it("a speaker's session count rises on assign and falls on remove (US-PROG-02/04)", async () => {
    const grace = await addSpeaker('Grace Hopper');
    const countFor = async (id: string): Promise<number> => {
      const res = await request(server)
        .get(`/api/v1/events/${eventId}/speakers`)
        .set('Authorization', `Bearer ${adminJwt}`);
      const rows = (res.body as Success<{ id: string; sessionCount: number }[]>)
        .data;
      return rows.find((s) => s.id === id)?.sessionCount ?? -1;
    };

    expect(await countFor(grace)).toBe(0);

    const created = await addSession(adminJwt, {
      day: 5,
      startTime: '11:00',
      endTime: '12:00',
      title: 'Compilers',
      type: 'Talk',
      room: 'Hall C',
      speakerIds: [grace],
    });
    expect(created.status).toBe(201);
    expect(await countFor(grace)).toBe(1);

    await request(server)
      .delete(
        `/api/v1/events/${eventId}/sessions/${(created.body as Success<Session>).data.id}?confirm=true`,
      )
      .set('Authorization', `Bearer ${adminJwt}`)
      .expect(200);

    // The speaker stays in the directory; only the count drops (US-PROG-04).
    expect(await countFor(grace)).toBe(0);
  });

  it('colours every block from its type, consistently (US-PROG-01)', async () => {
    const keynote = await addSession(adminJwt, {
      day: 6,
      startTime: '09:00',
      endTime: '10:00',
      title: 'Second Keynote',
      type: 'Keynote',
      room: 'Hall D',
    });
    const panel = await addSession(adminJwt, {
      day: 6,
      startTime: '10:00',
      endTime: '11:00',
      title: 'A Panel',
      type: 'Panel',
      room: 'Hall D',
    });
    expect((keynote.body as Success<Session>).data.color).toBe('blue');
    expect((panel.body as Success<Session>).data.color).toBe('green');

    // Colour is the server's to decide: sending one is refused outright rather
    // than silently ignored, so eventa-web finds out immediately.
    await addSession(adminJwt, {
      day: 6,
      startTime: '12:00',
      endTime: '13:00',
      title: 'Override attempt',
      type: 'Talk',
      color: 'rose',
    }).expect(400);
    // …and the very first Keynote in this suite gets the same blue.
    const list = await request(server)
      .get(`/api/v1/events/${eventId}/sessions`)
      .set('Authorization', `Bearer ${adminJwt}`);
    const keynotes = (list.body as Success<Session[]>).data.filter(
      (x) => x.type === 'Keynote',
    );
    expect(keynotes.length).toBeGreaterThan(1);
    expect(new Set(keynotes.map((k) => k.color))).toEqual(new Set(['blue']));
  });

  it("forbids adding a session to another tenant's event (404)", async () => {
    await request(server)
      .post(`/api/v1/events/${foreignEventId}/sessions`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ day: 1, startTime: '09:00', title: 'Sneaky', type: 'Talk' })
      .expect(404);
  });

  it('forbids a user without evSpeakers (403)', async () => {
    const limitedJwt = await token(LIMITED, ORG.slug);
    await addSession(limitedJwt, {
      day: 1,
      startTime: '09:00',
      title: 'Nope',
      type: 'Talk',
    }).expect(403);
  });
});

const PERM_GROUP: Record<string, string> = {
  evCreate: 'Events',
  evSpeakers: 'Events',
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
