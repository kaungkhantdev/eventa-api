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
import { listenOnLoopback } from './support/loopback';

/**
 * Authoring feedback surveys (US-MSG-09) against a real database.
 *
 * The rules have their own unit tests. What only this can prove is that a
 * survey and its questions land together, that replacing the question set
 * leaves no orphans behind, that a duplicate is genuinely independent of its
 * original, and that none of it crosses a workspace boundary.
 */

const PASSWORD = 'correct horse battery staple';
const ORG = { slug: 'srv-e2e', name: 'Surveys E2E' };
const ORG2 = { slug: 'srv-e2e-2', name: 'Surveys E2E 2' };
const ADMIN = 'admin@srv-e2e.test';
const OUTSIDER = 'nobody@srv-e2e.test';
const ADMIN2 = 'admin@srv-e2e-2.test';

const PERM_GROUP: Record<string, string> = {
  evCreate: 'Events',
  regView: 'Registrations',
};

interface Success<T> {
  data: T;
}
interface Survey {
  id: string;
  eventId: string;
  title: string;
  status: 'draft' | 'live' | 'closed';
  questions: { id: string; type: string; prompt: string; options: string[] }[];
}

const RATING = { type: 'rating', prompt: 'How was it?', options: [] };
const CHOICE = {
  type: 'choice',
  prompt: 'Best session?',
  options: ['Keynote', 'Panel'],
};

describe('Surveys (e2e — US-MSG-09)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let orgId: number;
  let otherOrgId: number;
  let summitId: string;
  let otherEventId: string;
  let adminJwt: string;
  let outsiderJwt: string;
  let otherJwt: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    orgId = await seedOrg(pool, ORG, [
      { email: ADMIN, roleName: 'Admin', grants: ['evCreate'] },
      { email: OUTSIDER, roleName: 'Staff', grants: ['regView'] },
    ]);
    otherOrgId = await seedOrg(pool, ORG2, [
      { email: ADMIN2, roleName: 'Admin', grants: ['evCreate'] },
    ]);
    summitId = await seedEvent(pool, orgId, 'srv-summit', 'Tech Summit 2026');
    otherEventId = await seedEvent(pool, otherOrgId, 'srv-other', 'Other Org');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await listenOnLoopback(app);
    server = app.getHttpServer() as Server;

    adminJwt = await token(ADMIN, ORG.slug);
    outsiderJwt = await token(OUTSIDER, ORG.slug);
    otherJwt = await token(ADMIN2, ORG2.slug);
  }, 30000);

  afterEach(async () => {
    await pool.query(`DELETE FROM surveys WHERE organization_id = ANY($1)`, [
      [orgId, otherOrgId],
    ]);
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

  const post = (jwt: string, body: object) =>
    request(server)
      .post('/api/v1/surveys')
      .set('Authorization', `Bearer ${jwt}`)
      .send(body);

  const patch = (jwt: string, path: string, body: object) =>
    request(server)
      .patch(`/api/v1/surveys/${path}`)
      .set('Authorization', `Bearer ${jwt}`)
      .send(body);

  const body = (res: { body: unknown }) => (res.body as Success<Survey>).data;

  const create = async (over: Record<string, unknown> = {}) =>
    body(
      await post(adminJwt, {
        eventId: summitId,
        title: 'Post-event feedback',
        questions: [RATING, CHOICE],
        ...over,
      }).expect(201),
    );

  describe('creating one', () => {
    it('starts as a draft, with its questions, in order', async () => {
      const survey = await create();
      expect(survey.status).toBe('draft');
      expect(survey.questions.map((q) => q.prompt)).toEqual([
        'How was it?',
        'Best session?',
      ]);
      expect(survey.questions[1].options).toEqual(['Keynote', 'Panel']);
    });

    it('keeps no options on a question that cannot have them', async () => {
      const survey = await create();
      expect(survey.questions[0].options).toEqual([]);
    });

    it('refuses a choice of one, and writes nothing', async () => {
      await post(adminJwt, {
        eventId: summitId,
        title: 'Bad',
        questions: [{ ...CHOICE, options: ['Only one'] }],
      }).expect(422);

      const rows = await pool.query(
        `SELECT 1 FROM surveys WHERE organization_id = $1`,
        [orgId],
      );
      expect(rows.rowCount).toBe(0);
    });

    it('refuses a survey with no questions', async () => {
      await post(adminJwt, {
        eventId: summitId,
        title: 'Empty',
        questions: [],
      }).expect(422);
    });

    it('404s an event belonging to another workspace', async () => {
      await post(adminJwt, {
        eventId: otherEventId,
        title: 'Sneaky',
        questions: [RATING],
      }).expect(404);
    });

    it('refuses a member without the event permission', async () => {
      await post(outsiderJwt, {
        eventId: summitId,
        title: 'Nope',
        questions: [RATING],
      }).expect(403);
    });
  });

  describe('editing one', () => {
    it('replaces the question set without leaving orphans', async () => {
      const survey = await create();
      const updated = body(
        await patch(adminJwt, survey.id, {
          title: 'Reworked',
          questions: [{ type: 'text', prompt: 'Anything else?', options: [] }],
        }).expect(200),
      );

      expect(updated.title).toBe('Reworked');
      expect(updated.questions).toHaveLength(1);

      const orphans = await pool.query(
        `SELECT 1 FROM survey_questions WHERE survey_id = $1`,
        [Number(survey.id)],
      );
      expect(orphans.rowCount).toBe(1);
    });

    it('refuses an edit that would make it unanswerable', async () => {
      const survey = await create();
      await patch(adminJwt, survey.id, {
        title: 'Reworked',
        questions: [],
      }).expect(422);
    });
  });

  describe('its life', () => {
    it('goes live, closes, and reopens', async () => {
      const survey = await create();
      expect(
        body(await patch(adminJwt, `${survey.id}/status`, { status: 'live' })),
      ).toMatchObject({ status: 'live' });
      expect(
        body(
          await patch(adminJwt, `${survey.id}/status`, { status: 'closed' }),
        ),
      ).toMatchObject({ status: 'closed' });
      expect(
        body(await patch(adminJwt, `${survey.id}/status`, { status: 'live' })),
      ).toMatchObject({ status: 'live' });
    });

    it('never goes back to a draft', async () => {
      const survey = await create();
      await patch(adminJwt, `${survey.id}/status`, { status: 'live' }).expect(
        200,
      );
      await patch(adminJwt, `${survey.id}/status`, { status: 'draft' }).expect(
        422,
      );
    });
  });

  describe('duplicating one', () => {
    it('makes an independent draft beside the original', async () => {
      const original = await create();
      await patch(adminJwt, `${original.id}/status`, { status: 'live' });

      const copy = body(
        await request(server)
          .post(`/api/v1/surveys/${original.id}/duplicate`)
          .set('Authorization', `Bearer ${adminJwt}`)
          .expect(201),
      );

      // A copy of a LIVE survey is still a draft: duplicating is for reuse,
      // not for quietly putting a second one in front of attendees.
      expect(copy.status).toBe('draft');
      expect(copy.id).not.toBe(original.id);
      expect(copy.title).toBe('Post-event feedback (copy)');
      expect(copy.questions.map((q) => q.prompt)).toEqual(
        original.questions.map((q) => q.prompt),
      );
      // Its questions are its OWN rows, so editing the copy cannot alter the
      // original.
      expect(copy.questions[0].id).not.toBe(original.questions[0].id);
    });
  });

  describe('deleting one', () => {
    it('takes its questions with it', async () => {
      const survey = await create();
      await request(server)
        .delete(`/api/v1/surveys/${survey.id}`)
        .set('Authorization', `Bearer ${adminJwt}`)
        .expect(204);

      const questions = await pool.query(
        `SELECT 1 FROM survey_questions WHERE survey_id = $1`,
        [Number(survey.id)],
      );
      expect(questions.rowCount).toBe(0);
    });
  });

  describe('across workspaces', () => {
    it('never lists or touches another workspace’s survey', async () => {
      const survey = await create();

      const theirs = await request(server)
        .get('/api/v1/surveys')
        .set('Authorization', `Bearer ${otherJwt}`)
        .expect(200);
      expect((theirs.body as Success<Survey[]>).data).toHaveLength(0);

      await patch(otherJwt, survey.id, {
        title: 'Hijacked',
        questions: [RATING],
      }).expect(404);
    });

    it('narrows the list to one event', async () => {
      await create();
      const res = await request(server)
        .get(`/api/v1/surveys?eventId=${summitId}`)
        .set('Authorization', `Bearer ${adminJwt}`)
        .expect(200);
      expect((res.body as Success<Survey[]>).data).toHaveLength(1);
    });
  });
});

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
       VALUES ($1, 'Anan Suksawat', $2, 'admin', 'Active', $3) RETURNING id`,
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
  name: string,
): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO events (organization_id, slug, name, type, bucket, status, visibility,
                         start_at, end_at, timezone, organizer_name, venue_name, city, published_at)
     VALUES ($1,$2,$3,'Conference','active','live','public',
             now() + interval '10 days', now() + interval '10 days' + interval '8 hours',
             'Asia/Bangkok','Acme','QSNCC','Bangkok', now())
     RETURNING id`,
    [orgId, slug, name],
  );
  return res.rows[0].id;
}

async function cleanup(pool: Pool): Promise<void> {
  const slugs = [ORG.slug, ORG2.slug];
  // audit_events does NOT cascade from organizations, and signing in writes one.
  for (const table of [
    'audit_events',
    'outbox_events',
    'survey_questions',
    'surveys',
    'events',
  ]) {
    await pool.query(
      `DELETE FROM ${table} WHERE organization_id IN
         (SELECT id FROM organizations WHERE slug = ANY($1))`,
      [slugs],
    );
  }
  await pool.query(`DELETE FROM organizations WHERE slug = ANY($1)`, [slugs]);
}
