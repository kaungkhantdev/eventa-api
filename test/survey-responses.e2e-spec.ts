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
 * Answering a survey, and what the answers add up to (US-MSG-08/10).
 *
 * The two rules everything else rests on are only provable here: a survey is
 * offered ONLY to somebody with a confirmed registration for that event, and
 * each of them answers ONCE. Without both, an event's rating is a number
 * anyone holding a link could move.
 */

const PASSWORD = 'correct horse battery staple';
const ORG = { slug: 'rsp-e2e', name: 'Responses E2E' };
const ADMIN = 'admin@rsp-e2e.test';
const WENT = 'went@rsp-e2e.test';
const STAYED_HOME = 'absent@rsp-e2e.test';

const PERM_GROUP: Record<string, string> = { evCreate: 'Events' };

interface Success<T> {
  data: T;
}
interface MySurvey {
  surveyId: string | null;
  title: string | null;
  answered: boolean;
  questions: { id: string; type: string; prompt: string; options: string[] }[];
}

describe('Survey responses (e2e — US-MSG-08/10)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let orgId: number;
  let eventId: string;
  let adminJwt: string;
  let wentJwt: string;
  let absentJwt: string;
  let surveyId: string;
  let seq = 0;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    orgId = await seedOrg(pool, ORG, [
      { email: ADMIN, roleName: 'Admin', grants: ['evCreate'] },
    ]);
    eventId = await seedEvent(pool, orgId, 'rsp-summit', 'Tech Summit 2026');
    // Attendees belong to the PLATFORM org, not the organizer's workspace.
    await seedAttendee(pool, WENT);
    await seedAttendee(pool, STAYED_HOME);
    await seedOrder(pool, orgId, eventId, WENT);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await listenOnLoopback(app);
    server = app.getHttpServer() as Server;

    adminJwt = await token(ADMIN, 'admin');
    wentJwt = await token(WENT, 'attendee');
    absentJwt = await token(STAYED_HOME, 'attendee');
  }, 30000);

  beforeEach(async () => {
    const res = await request(server)
      .post('/api/v1/surveys')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({
        eventId,
        title: 'Post-event feedback',
        questions: [
          { type: 'rating', prompt: 'How was it?', options: [] },
          { type: 'text', prompt: 'Anything else?', options: [] },
          {
            type: 'choice',
            prompt: 'Best bit?',
            options: ['Keynote', 'Panel'],
          },
        ],
      })
      .expect(201);
    surveyId = (res.body as Success<{ id: string }>).data.id;
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM surveys WHERE organization_id = $1`, [orgId]);
  });

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  /**
   * An organizer signs into a WORKSPACE; an attendee signs in globally. That
   * asymmetry is the whole reason the attendee queries are cross-tenant —
   * somebody's events span every workspace on the platform.
   */
  async function token(email: string, persona: string): Promise<string> {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({
        email,
        password: PASSWORD,
        persona,
        ...(persona === 'admin' ? { orgSlug: ORG.slug } : {}),
      });
    return (res.body as Success<{ accessToken: string }>).data.accessToken;
  }

  const makeLive = () =>
    request(server)
      .patch(`/api/v1/surveys/${surveyId}/status`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ status: 'live' })
      .expect(200);

  const mine = (jwt: string) =>
    request(server)
      .get(`/api/v1/me/surveys/${eventId}`)
      .set('Authorization', `Bearer ${jwt}`);

  const submit = (jwt: string, answers: unknown[]) =>
    request(server)
      .post(`/api/v1/me/surveys/${eventId}`)
      .set('Authorization', `Bearer ${jwt}`)
      .send({ answers });

  const good = async (jwt: string) => {
    const survey = (await mine(jwt).expect(200)).body as Success<MySurvey>;
    const byType = (type: string) =>
      survey.data.questions.find((q) => q.type === type)!.id;
    return [
      { questionId: byType('rating'), rating: 5 },
      { questionId: byType('choice'), choice: 'Panel' },
      { questionId: byType('text'), answerText: 'Loved the venue' },
    ];
  };

  describe('who is asked', () => {
    it('offers a live survey to somebody who went', async () => {
      await makeLive();
      const res = await mine(wentJwt).expect(200);
      const survey = (res.body as Success<MySurvey>).data;
      expect(survey.surveyId).toBe(surveyId);
      expect(survey.questions).toHaveLength(3);
      expect(survey.answered).toBe(false);
    });

    it('offers nothing to somebody who did not', async () => {
      // No confirmed registration, no survey. Otherwise a rating is a number
      // anyone with the link could move.
      await makeLive();
      const res = await mine(absentJwt).expect(200);
      expect((res.body as Success<MySurvey>).data.surveyId).toBeNull();
    });

    it('offers nothing while the survey is still a draft', async () => {
      const res = await mine(wentJwt).expect(200);
      expect((res.body as Success<MySurvey>).data.surveyId).toBeNull();
    });
  });

  describe('answering', () => {
    it('records the response and every answer', async () => {
      await makeLive();
      await submit(wentJwt, await good(wentJwt)).expect(200);

      const responses = await pool.query<{ id: string }>(
        `SELECT id FROM survey_responses WHERE organization_id = $1`,
        [orgId],
      );
      expect(responses.rowCount).toBe(1);

      const answers = await pool.query<{
        rating: number | null;
        answer_text: string | null;
        choice: string | null;
      }>(
        `SELECT rating, answer_text, choice FROM survey_answers
         WHERE response_id = $1 ORDER BY id`,
        [responses.rows[0].id],
      );
      expect(answers.rowCount).toBe(3);
      expect(answers.rows.map((row) => row.rating)).toContain(5);
      expect(answers.rows.map((row) => row.choice)).toContain('Panel');
      expect(answers.rows.map((row) => row.answer_text)).toContain(
        'Loved the venue',
      );
    });

    it('refuses a second answer from the same person', async () => {
      await makeLive();
      const answers = await good(wentJwt);
      await submit(wentJwt, answers).expect(200);
      // 409, not a silent overwrite: the first answer is the honest one.
      await submit(wentJwt, answers).expect(409);
    });

    it('says so on the way back in, so the form is not offered twice', async () => {
      await makeLive();
      await submit(wentJwt, await good(wentJwt)).expect(200);
      const res = await mine(wentJwt).expect(200);
      expect((res.body as Success<MySurvey>).data.answered).toBe(true);
    });

    it('refuses somebody who did not go', async () => {
      await makeLive();
      await submit(absentJwt, [{ questionId: '1', rating: 5 }]).expect(404);
    });

    it('insists on the rating', async () => {
      await makeLive();
      const answers = await good(wentJwt);
      await submit(
        wentJwt,
        answers.filter((a) => !('rating' in a)),
      ).expect(422);
    });

    it('refuses a choice that was never offered', async () => {
      await makeLive();
      const answers = await good(wentJwt);
      await submit(
        wentJwt,
        answers.map((a) =>
          'choice' in a ? { ...a, choice: 'Something else' } : a,
        ),
      ).expect(422);
    });

    it('refuses a rating off the scale before it reaches the rules', async () => {
      await makeLive();
      const answers = await good(wentJwt);
      await submit(
        wentJwt,
        answers.map((a) => ('rating' in a ? { ...a, rating: 9 } : a)),
      ).expect(400);
    });
  });

  describe('what the organizer sees', () => {
    it('averages the ratings and breaks them down', async () => {
      await makeLive();
      await submit(wentJwt, await good(wentJwt)).expect(200);

      const res = await request(server)
        .get(`/api/v1/surveys/summary?eventId=${eventId}`)
        .set('Authorization', `Bearer ${adminJwt}`)
        .expect(200);

      const summary = (
        res.body as Success<{
          responses: number;
          average: number | null;
          distribution: Record<string, number>;
        }>
      ).data;
      expect(summary.responses).toBe(1);
      expect(summary.average).toBe(5);
      expect(summary.distribution['5']).toBe(1);
    });

    it('has no average before anybody has answered', async () => {
      const res = await request(server)
        .get(`/api/v1/surveys/summary?eventId=${eventId}`)
        .set('Authorization', `Bearer ${adminJwt}`)
        .expect(200);
      const summary = (res.body as Success<{ average: number | null }>).data;
      // Not 0. Nought out of five is a verdict; this is the absence of one.
      expect(summary.average).toBeNull();
    });

    it('lists who said what', async () => {
      await makeLive();
      await submit(wentJwt, await good(wentJwt)).expect(200);

      const res = await request(server)
        .get(`/api/v1/surveys/responses?eventId=${eventId}`)
        .set('Authorization', `Bearer ${adminJwt}`)
        .expect(200);

      const rows = (res.body as Success<{ rating: number; comment: string }[]>)
        .data;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ rating: 5, comment: 'Loved the venue' });
    });
  });

  async function seedOrder(
    pool: Pool,
    org: number,
    event: string,
    email: string,
  ): Promise<void> {
    seq += 1;
    await pool.query(
      `INSERT INTO orders (organization_id, reference, event_id, buyer_name, buyer_email,
                           status, payment_status, seats, subtotal_satang,
                           vat_amount_satang, total_satang, registered_at)
       VALUES ($1,$2,$3,'Anong Pattana',$4,'confirmed','paid',1,0,0,0, now())`,
      [org, `ORD-RSP-${seq}`, event, email],
    );
  }
});

async function seedAttendee(pool: Pool, email: string): Promise<void> {
  const passwordHash = await hash(PASSWORD);
  await pool.query(
    `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
     SELECT id, 'Anong Pattana', $1, 'attendee', 'Active', $2
     FROM organizations WHERE slug = 'eventa'`,
    [email, passwordHash],
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
     VALUES ($1,$2,$3,'Conference','completed','completed','public',
             now() - interval '10 days', now() - interval '10 days' + interval '8 hours',
             'Asia/Bangkok','Acme','QSNCC','Bangkok', now())
     RETURNING id`,
    [orgId, slug, name],
  );
  return res.rows[0].id;
}

async function cleanup(pool: Pool): Promise<void> {
  const slugs = [ORG.slug];
  for (const table of [
    'audit_events',
    'outbox_events',
    'survey_answers',
    'survey_responses',
    'survey_questions',
    'surveys',
    'orders',
    'events',
  ]) {
    await pool.query(
      `DELETE FROM ${table} WHERE organization_id IN
         (SELECT id FROM organizations WHERE slug = ANY($1))`,
      [slugs],
    );
  }
  await pool.query(`DELETE FROM organizations WHERE slug = ANY($1)`, [slugs]);
  // The attendees live in the platform org, so the cascade above misses them.
  await pool.query(`DELETE FROM users WHERE email = ANY($1)`, [
    [WENT, STAYED_HOME],
  ]);
}
