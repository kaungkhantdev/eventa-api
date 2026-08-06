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
const ORG = { slug: 'saved-e2e', name: 'Saved E2E' };
const ANAN = 'anan@saved-e2e.test';
const MALEE = 'malee@saved-e2e.test';

const PUBLIC_ONE = 'sav-public-one';
const PUBLIC_TWO = 'sav-public-two';
const PRIVATE = 'sav-private';
const UNKNOWN_EVENT = '00000000-0000-4000-8000-0000000000ff';
const BAHT = 100;

interface Success<T> {
  data: T;
}
interface Card {
  id: string;
  slug: string;
  priceFrom: string | null;
  badge: string | null;
}
interface CardPage {
  data: Card[];
  meta: { total: number };
}

describe('Saved events (e2e — US-DISC-03)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let anan: string;
  let malee: string;
  let ids: Record<string, string>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    ids = await seed(pool);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();
    server = app.getHttpServer() as Server;

    anan = await signIn(server, ANAN);
    malee = await signIn(server, MALEE);
  }, 30000);

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  const list = (token: string) =>
    request(server)
      .get('/api/v1/me/saved-events')
      .set('Authorization', `Bearer ${token}`);
  const save = (token: string, eventId: string) =>
    request(server)
      .put(`/api/v1/me/saved-events/${eventId}`)
      .set('Authorization', `Bearer ${token}`);
  const unsave = (token: string, eventId: string) =>
    request(server)
      .delete(`/api/v1/me/saved-events/${eventId}`)
      .set('Authorization', `Bearer ${token}`);
  const merge = (token: string, eventIds: string[]) =>
    request(server)
      .post('/api/v1/me/saved-events/merge')
      .set('Authorization', `Bearer ${token}`)
      .send({ eventIds });

  beforeEach(async () => {
    // Scoped to this suite's own attendees. An unqualified DELETE would wipe
    // rows belonging to other suites the moment these stop running in band.
    await pool.query(
      `DELETE FROM saved_events WHERE user_id IN
         (SELECT id FROM users WHERE email = ANY($1))`,
      [[ANAN, MALEE]],
    );
  });

  it('starts empty for an attendee who has saved nothing', async () => {
    const res = await list(anan);
    expect(res.status).toBe(200);
    const page = res.body as CardPage;
    expect(page.data).toEqual([]);
    expect(page.meta.total).toBe(0);
  });

  it('keeps a saved event, with the same card the grid shows', async () => {
    expect((await save(anan, ids[PUBLIC_ONE])).status).toBe(204);
    const page = (await list(anan)).body as CardPage;
    expect(page.data).toHaveLength(1);
    expect(page.data[0]).toMatchObject({
      slug: PUBLIC_ONE,
      priceFrom: '฿1,200',
      badge: null,
    });
  });

  it('tapping the heart twice leaves one save, not two', async () => {
    await save(anan, ids[PUBLIC_ONE]);
    expect((await save(anan, ids[PUBLIC_ONE])).status).toBe(204);
    expect(((await list(anan)).body as CardPage).meta.total).toBe(1);
  });

  it('still shows the save on a fresh sign-in — it lives on the account', async () => {
    await save(anan, ids[PUBLIC_ONE]);
    const onAnotherDevice = await signIn(server, ANAN);
    const page = (await list(onAnotherDevice)).body as CardPage;
    expect(page.data.map((c) => c.slug)).toEqual([PUBLIC_ONE]);
  });

  it('shows the most recently saved first', async () => {
    await save(anan, ids[PUBLIC_ONE]);
    await save(anan, ids[PUBLIC_TWO]);
    const page = (await list(anan)).body as CardPage;
    expect(page.data.map((c) => c.slug)).toEqual([PUBLIC_TWO, PUBLIC_ONE]);
  });

  it('unsaves, and shrugs off unsaving the same thing again', async () => {
    await save(anan, ids[PUBLIC_ONE]);
    expect((await unsave(anan, ids[PUBLIC_ONE])).status).toBe(204);
    expect((await unsave(anan, ids[PUBLIC_ONE])).status).toBe(204);
    expect(((await list(anan)).body as CardPage).meta.total).toBe(0);
  });

  it('refuses to save an event that was never published', async () => {
    const res = await save(anan, ids[PRIVATE]);
    expect(res.status).toBe(404);
    expect(((await list(anan)).body as CardPage).meta.total).toBe(0);
  });

  it('refuses to save an event that does not exist', async () => {
    expect((await save(anan, UNKNOWN_EVENT)).status).toBe(404);
  });

  it('rejects an id that is not a uuid rather than guessing', async () => {
    expect((await save(anan, 'not-a-uuid')).status).toBe(400);
  });

  it('never shows one attendee another’s saves', async () => {
    await save(anan, ids[PUBLIC_ONE]);
    expect(((await list(malee)).body as CardPage).meta.total).toBe(0);
  });

  it('drops a saved event once the organizer takes it down', async () => {
    await save(anan, ids[PUBLIC_ONE]);
    await pool.query(`UPDATE events SET visibility = 'private' WHERE id = $1`, [
      ids[PUBLIC_ONE],
    ]);
    const page = (await list(anan)).body as CardPage;
    expect(page.data).toEqual([]);
    await pool.query(`UPDATE events SET visibility = 'public' WHERE id = $1`, [
      ids[PUBLIC_ONE],
    ]);
  });

  describe('merging a guest’s in-session saves at sign-in', () => {
    it('adopts them into the account', async () => {
      const res = await merge(anan, [ids[PUBLIC_ONE], ids[PUBLIC_TWO]]);
      expect(res.status).toBe(200);
      expect((res.body as Success<{ merged: number }>).data.merged).toBe(2);
      expect(((await list(anan)).body as CardPage).meta.total).toBe(2);
    });

    it('adds no duplicate for one already saved', async () => {
      await save(anan, ids[PUBLIC_ONE]);
      const res = await merge(anan, [ids[PUBLIC_ONE], ids[PUBLIC_TWO]]);
      expect((res.body as Success<{ merged: number }>).data.merged).toBe(1);
      expect(((await list(anan)).body as CardPage).meta.total).toBe(2);
    });

    it('is safe to replay — a second merge changes nothing', async () => {
      await merge(anan, [ids[PUBLIC_ONE], ids[PUBLIC_TWO]]);
      const again = await merge(anan, [ids[PUBLIC_ONE], ids[PUBLIC_TWO]]);
      expect((again.body as Success<{ merged: number }>).data.merged).toBe(0);
      expect(((await list(anan)).body as CardPage).meta.total).toBe(2);
    });

    it('drops ids that no longer resolve rather than failing the sign-in', async () => {
      const res = await merge(anan, [
        ids[PUBLIC_ONE],
        UNKNOWN_EVENT,
        ids[PRIVATE],
      ]);
      expect(res.status).toBe(200);
      expect((res.body as Success<{ merged: number }>).data.merged).toBe(1);
    });

    it('accepts an empty list from a guest who saved nothing', async () => {
      const res = await merge(anan, []);
      expect((res.body as Success<{ merged: number }>).data.merged).toBe(0);
    });

    it('rejects an implausibly long list rather than absorbing it', async () => {
      const many = Array.from({ length: 101 }, () => UNKNOWN_EVENT);
      expect((await merge(anan, many)).status).toBe(400);
    });
  });

  it('refuses every route without a token — a save belongs to someone', async () => {
    expect((await request(server).get('/api/v1/me/saved-events')).status).toBe(
      401,
    );
    expect(
      (await request(server).put(`/api/v1/me/saved-events/${ids[PUBLIC_ONE]}`))
        .status,
    ).toBe(401);
  });
});

async function signIn(server: Server, email: string): Promise<string> {
  // No orgSlug: attendees live in the platform workspace (US-DISC-08).
  const res = await request(server).post('/api/v1/auth/login').send({
    email,
    password: PASSWORD,
    persona: 'attendee',
  });
  expect(res.status).toBe(200);
  return (res.body as Success<{ accessToken: string }>).data.accessToken;
}

async function seed(pool: Pool): Promise<Record<string, string>> {
  const org = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1,$2) RETURNING id`,
    [ORG.name, ORG.slug],
  );
  const orgId = Number(org.rows[0].id);
  const platform = await pool.query<{ id: string }>(
    `SELECT id FROM organizations WHERE slug = 'eventa'`,
  );
  const platformOrgId = Number(platform.rows[0].id);
  const passwordHash = await hash(PASSWORD);
  for (const email of [ANAN, MALEE]) {
    // Attendee accounts live in the platform org, whatever workspace runs the event.
    await pool.query(
      `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
       VALUES ($1,'Attendee',$2,'attendee','Active',$3)`,
      [platformOrgId, email, passwordHash],
    );
  }

  const ids: Record<string, string> = {};
  ids[PUBLIC_ONE] = await insertEvent(pool, orgId, PUBLIC_ONE, 'One', true);
  ids[PUBLIC_TWO] = await insertEvent(pool, orgId, PUBLIC_TWO, 'Two', true);
  ids[PRIVATE] = await insertEvent(pool, orgId, PRIVATE, 'Secret', false);
  for (const slug of [PUBLIC_ONE, PUBLIC_TWO]) {
    await pool.query(
      `INSERT INTO ticket_types (organization_id, event_id, name, price_satang,
                                 status, total, sold)
       VALUES ($1,$2,'General',$3,'onsale',100,0)`,
      [orgId, ids[slug], 1_200 * BAHT],
    );
  }
  return ids;
}

async function insertEvent(
  pool: Pool,
  orgId: number,
  slug: string,
  name: string,
  isPublic: boolean,
): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO events (organization_id, slug, name, type, bucket, status, visibility,
                         start_at, timezone, organizer_name, published_at)
     VALUES ($1,$2,$3,'Conference','active',$4,$5,
             now() + interval '30 days','Asia/Bangkok','Acme',
             CASE WHEN $6 THEN now() ELSE NULL END)
     RETURNING id`,
    [
      orgId,
      slug,
      name,
      isPublic ? 'upcoming' : 'draft',
      isPublic ? 'public' : 'private',
      isPublic,
    ],
  );
  return res.rows[0].id;
}

async function cleanup(pool: Pool): Promise<void> {
  // The platform org is shared and permanent — remove only OUR users from it.
  await pool.query(
    `DELETE FROM outbox_events WHERE aggregate_id IN
       (SELECT id::text FROM users WHERE email = ANY($1))`,
    [[ANAN, MALEE]],
  );
  await pool.query(`DELETE FROM users WHERE email = ANY($1)`, [[ANAN, MALEE]]);
  await pool.query(`DELETE FROM organizations WHERE slug = $1`, [ORG.slug]);
}
