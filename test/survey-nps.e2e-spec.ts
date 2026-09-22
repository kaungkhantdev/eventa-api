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
 * The recommendation question and the NPS it adds up to (US-MSG-08/09).
 *
 * The rule itself has unit tests. What only a real database proves is that a
 * 0 survives the trip to its own column, that nothing on the rating side —
 * the average, the star breakdown, the rating lifted into the responses list —
 * ever sees an NPS answer, and that the figure is scoped by event and by
 * survey the way the organizer's screens ask for it.
 */

const PASSWORD = 'correct horse battery staple';
const ORG = { slug: 'nps-e2e', name: 'NPS E2E' };
const ADMIN = 'admin@nps-e2e.test';
/** Four people who went to the summit; the first also went to the meetup. */
const ATTENDEES = [
  'one@nps-e2e.test',
  'two@nps-e2e.test',
  'three@nps-e2e.test',
  'four@nps-e2e.test',
];

/** Emailed the meetup's thank-you, but has no account and never answers. */
const GUEST = 'guest@nps-e2e.test';
const THANK_YOU = 'post-event-thankyou';
/** Postgres's SQLSTATE for a broken UNIQUE constraint. */
const UNIQUE_VIOLATION = '23505';

const PERM_GROUP: Record<string, string> = { evCreate: 'Events' };

const NPS = {
  type: 'nps',
  prompt: 'How likely are you to recommend it to a friend?',
  options: [],
};
const RATING = { type: 'rating', prompt: 'How was it?', options: [] };

interface Success<T> {
  data: T;
}
interface Question {
  id: string;
  type: string;
}
interface Nps {
  score: number | null;
  answers: number;
  promoters: number;
  passives: number;
  detractors: number;
}
interface Summary {
  responses: number;
  average: number | null;
  distribution: Record<string, number>;
  asked: number;
  completionRate: number | null;
  nps: Nps;
}

describe('NPS (e2e — US-MSG-08/09)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let orgId: number;
  let summitId: string;
  let meetupId: string;
  let adminJwt: string;
  let attendeeJwts: string[];
  let seq = 0;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    orgId = await seedOrg(pool);
    summitId = await seedEvent(pool, orgId, 'nps-summit', 'Tech Summit 2026');
    meetupId = await seedEvent(pool, orgId, 'nps-meetup', 'Meetup');
    // Attendees belong to the PLATFORM org, not the organizer's workspace.
    for (const email of ATTENDEES) {
      await seedAttendee(pool, email);
      await seedOrder(summitId, email);
    }
    await seedOrder(meetupId, ATTENDEES[0]);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await listenOnLoopback(app);
    server = app.getHttpServer() as Server;

    adminJwt = await token(ADMIN, 'admin');
    attendeeJwts = [];
    for (const email of ATTENDEES) {
      attendeeJwts.push(await token(email, 'attendee'));
    }
  }, 30000);

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  const deleteSurveys = () =>
    pool.query(`DELETE FROM surveys WHERE organization_id = $1`, [orgId]);

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

  const writeSurvey = (eventId: string, questions: unknown[]) =>
    request(server)
      .post('/api/v1/surveys')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ eventId, title: 'Post-event feedback', questions });

  /** A live survey, questions in the order given. */
  async function liveSurvey(
    eventId: string,
    questions: unknown[],
  ): Promise<string> {
    const res = await writeSurvey(eventId, questions).expect(201);
    const id = (res.body as Success<{ id: string }>).data.id;
    await request(server)
      .patch(`/api/v1/surveys/${id}/status`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ status: 'live' })
      .expect(200);
    return id;
  }

  async function questionIds(
    jwt: string,
    eventId: string,
  ): Promise<Record<string, string>> {
    const res = await request(server)
      .get(`/api/v1/me/surveys/${eventId}`)
      .set('Authorization', `Bearer ${jwt}`)
      .expect(200);
    const questions = (res.body as Success<{ questions: Question[] }>).data
      .questions;
    return Object.fromEntries(questions.map((q) => [q.type, q.id]));
  }

  const submit = (jwt: string, eventId: string, answers: unknown[]) =>
    request(server)
      .post(`/api/v1/me/surveys/${eventId}`)
      .set('Authorization', `Bearer ${jwt}`)
      .send({ answers });

  async function summary(query: Record<string, string> = {}): Promise<Summary> {
    const res = await request(server)
      .get('/api/v1/surveys/summary')
      .query(query)
      .set('Authorization', `Bearer ${adminJwt}`)
      .expect(200);
    return (res.body as Success<Summary>).data;
  }

  describe('writing a recommendation question', () => {
    afterEach(deleteSurveys);

    it('saves one, and reads it back as `nps`', async () => {
      const res = await writeSurvey(summitId, [NPS, RATING]).expect(201);
      const survey = (res.body as Success<{ questions: Question[] }>).data;
      expect(survey.questions.map((q) => q.type)).toEqual(['nps', 'rating']);
    });

    it('asks it once per survey', async () => {
      // Two would count one person twice in that survey's NPS.
      await writeSurvey(summitId, [
        NPS,
        { ...NPS, prompt: 'And again?' },
      ]).expect(422);
    });
  });

  describe('answering it', () => {
    let ids: Record<string, string>;
    const jwt = () => attendeeJwts[0];

    beforeEach(async () => {
      await liveSurvey(summitId, [NPS, RATING]);
      ids = await questionIds(jwt(), summitId);
    });

    afterEach(deleteSurveys);

    it('stores a 0 as 0, in its own column', async () => {
      // 0 is the harshest answer there is, not a missing one.
      await submit(jwt(), summitId, [
        { questionId: ids.nps, score: 0 },
        { questionId: ids.rating, rating: 4 },
      ]).expect(200);

      const rows = await pool.query<{
        score: number | null;
        rating: number | null;
      }>(
        `SELECT a.score, a.rating FROM survey_answers a
         WHERE a.organization_id = $1 AND a.question_id = $2`,
        [orgId, ids.nps],
      );
      expect(rows.rows).toEqual([{ score: 0, rating: null }]);
    });

    it('refuses a score off the scale before it reaches the rules', async () => {
      await submit(jwt(), summitId, [
        { questionId: ids.nps, score: 11 },
        { questionId: ids.rating, rating: 4 },
      ]).expect(400);
    });

    it('refuses a recommendation answered as a star rating', async () => {
      // A 5 there would land in the average, not the NPS.
      await submit(jwt(), summitId, [
        { questionId: ids.nps, rating: 5 },
        { questionId: ids.rating, rating: 4 },
      ]).expect(422);
    });

    it('refuses a score sent with a star rating', async () => {
      // Stored, it would count in the NPS through a question that never asked.
      await submit(jwt(), summitId, [
        { questionId: ids.nps, score: 9 },
        { questionId: ids.rating, rating: 4, score: 10 },
      ]).expect(422);
    });

    it('refuses the same recommendation answered twice, and counts none of it', async () => {
      // Thirty 10s in one response would be thirty promoters from one person.
      const stuffed = Array.from({ length: 29 }, () => ({
        questionId: ids.nps,
        score: 10,
      }));
      const res = await submit(jwt(), summitId, [
        { questionId: ids.rating, rating: 4 },
        ...stuffed,
      ]).expect(422);
      expect(JSON.stringify(res.body)).toContain('was answered twice');
      expect((await summary({ eventId: summitId })).nps.answers).toBe(0);
    });

    it('holds one answer per question per response in the table itself', async () => {
      // The rule above is the first line; this is the one a future write path
      // that skips it still runs into.
      await submit(jwt(), summitId, [
        { questionId: ids.nps, score: 3 },
        { questionId: ids.rating, rating: 4 },
      ]).expect(200);

      await expect(
        pool.query(
          `INSERT INTO survey_answers (organization_id, response_id, question_id, score)
           SELECT organization_id, response_id, question_id, 10
           FROM survey_answers WHERE organization_id = $1 AND question_id = $2`,
          [orgId, ids.nps],
        ),
      ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
      expect((await summary({ eventId: summitId })).nps).toMatchObject({
        answers: 1,
        detractors: 1,
      });
    });
  });

  describe('counting who answered', () => {
    afterEach(deleteSurveys);

    /** Every attendee given answers the survey, question type by type. */
    async function answerAll(
      eventId: string,
      people: string[],
      answerOf: (ids: Record<string, string>) => unknown[],
    ): Promise<void> {
      for (const jwt of people) {
        const ids = await questionIds(jwt, eventId);
        await submit(jwt, eventId, answerOf(ids)).expect(200);
      }
    }

    it('counts the people who answered a survey that asks for no stars', async () => {
      // Recommendation only: three answers are three responses, not nobody.
      const survey = await liveSurvey(summitId, [NPS]);
      await answerAll(summitId, attendeeJwts.slice(0, 3), (ids) => [
        { questionId: ids.nps, score: 9 },
      ]);

      const figures = await summary({ surveyId: survey });
      expect(figures.responses).toBe(3);
      expect(figures.average).toBeNull();
      expect(figures.nps.answers).toBe(3);
    });

    it('counts a person once however many star questions they answered', async () => {
      const survey = await liveSurvey(summitId, [
        RATING,
        { ...RATING, prompt: 'And the venue?' },
      ]);
      for (const jwt of attendeeJwts.slice(0, 2)) {
        const res = await request(server)
          .get(`/api/v1/me/surveys/${summitId}`)
          .set('Authorization', `Bearer ${jwt}`)
          .expect(200);
        const questions = (res.body as Success<{ questions: Question[] }>).data
          .questions;
        await submit(
          jwt,
          summitId,
          questions.map((q) => ({ questionId: q.id, rating: 4 })),
        ).expect(200);
      }

      const figures = await summary({ surveyId: survey });
      expect(figures.responses).toBe(2);
      // The stars are still every rating given: two each.
      expect(figures.distribution['4']).toBe(4);
    });

    it("counts only the scoped survey's people", async () => {
      const first = await liveSurvey(summitId, [NPS]);
      await answerAll(summitId, attendeeJwts.slice(0, 2), (ids) => [
        { questionId: ids.nps, score: 9 },
      ]);
      await request(server)
        .patch(`/api/v1/surveys/${first}/status`)
        .set('Authorization', `Bearer ${adminJwt}`)
        .send({ status: 'closed' })
        .expect(200);
      const second = await liveSurvey(summitId, [RATING]);
      await answerAll(summitId, attendeeJwts.slice(0, 1), (ids) => [
        { questionId: ids.rating, rating: 5 },
      ]);

      expect((await summary({ surveyId: first })).responses).toBe(2);
      expect((await summary({ surveyId: second })).responses).toBe(1);
      expect((await summary({ eventId: summitId })).responses).toBe(3);
      expect((await summary({ eventId: meetupId })).responses).toBe(0);
    });
  });

  describe('what the organizer sees', () => {
    let summitSurvey: string;
    let meetupSurvey: string;

    beforeAll(async () => {
      // The summit: 10, 9, 7 and 3 — two promoters, a passive, a detractor —
      // and every one of them gave five stars.
      summitSurvey = await liveSurvey(summitId, [NPS, RATING]);
      const scores = [10, 9, 7, 3];
      for (const [index, score] of scores.entries()) {
        const ids = await questionIds(attendeeJwts[index], summitId);
        await submit(attendeeJwts[index], summitId, [
          { questionId: ids.nps, score },
          { questionId: ids.rating, rating: 5 },
        ]).expect(200);
      }
      // The meetup asked nobody to recommend it.
      meetupSurvey = await liveSurvey(meetupId, [RATING]);
      const ids = await questionIds(attendeeJwts[0], meetupId);
      await submit(attendeeJwts[0], meetupId, [
        { questionId: ids.rating, rating: 3 },
      ]).expect(200);
    }, 30000);

    afterAll(deleteSurveys);

    const summitNps = {
      score: 25,
      answers: 4,
      promoters: 2,
      passives: 1,
      detractors: 1,
    };

    it("scores an event's recommendations", async () => {
      expect((await summary({ eventId: summitId })).nps).toEqual(summitNps);
    });

    it('keeps every recommendation out of the star rating', async () => {
      // A 0 or a 9 in the rating column would drag the average and invent a
      // star the scale does not have.
      const figures = await summary({ eventId: summitId });
      expect(figures.average).toBe(5);
      expect(Object.keys(figures.distribution).sort()).toEqual([
        '1',
        '2',
        '3',
        '4',
        '5',
      ]);
      expect(figures.distribution['5']).toBe(4);
    });

    it('has no NPS, not 0, where nobody was asked to recommend', async () => {
      expect((await summary({ eventId: meetupId })).nps).toEqual({
        score: null,
        answers: 0,
        promoters: 0,
        passives: 0,
        detractors: 0,
      });
    });

    it('pools every answer across the workspace', async () => {
      // The meetup adds nothing to the pool, so it cannot drag it anywhere.
      expect((await summary()).nps).toEqual(summitNps);
    });

    it('scores one survey on its own', async () => {
      expect((await summary({ surveyId: summitSurvey })).nps.score).toBe(25);
      expect((await summary({ surveyId: meetupSurvey })).nps.score).toBeNull();
    });

    it('lifts the star rating into the list, with the recommendation asked first', async () => {
      const res = await request(server)
        .get(`/api/v1/surveys/responses?eventId=${summitId}`)
        .set('Authorization', `Bearer ${adminJwt}`)
        .expect(200);
      const rows = (res.body as Success<{ rating: number | null }[]>).data;
      expect(rows).toHaveLength(4);
      expect(rows.every((row) => row.rating === 5)).toBe(true);
    });

    it('reads completion for the same survey as the NPS beside it', async () => {
      // The summit's thank-you reached all four, who all answered; the
      // meetup's reached one of them and a guest. Scoped to a survey, both
      // halves of completion are that survey's: the thank-you for ITS event,
      // and answers to IT — not the workspace's six asked.
      for (const email of ATTENDEES) await seedAsked(summitId, email);
      await seedAsked(meetupId, ATTENDEES[0]);
      await seedAsked(meetupId, GUEST);

      expect(await summary({ surveyId: summitSurvey })).toMatchObject({
        asked: 4,
        completionRate: 100,
      });
      expect(await summary({ surveyId: meetupSurvey })).toMatchObject({
        asked: 2,
        completionRate: 50,
      });

      // A second meetup survey nobody answered: the answer to the first one
      // does not complete it.
      const res = await writeSurvey(meetupId, [RATING]).expect(201);
      const unanswered = (res.body as Success<{ id: string }>).data.id;
      expect(await summary({ surveyId: unanswered })).toMatchObject({
        asked: 2,
        completionRate: 0,
      });
    });

    it('refuses a survey id that is not a number', async () => {
      await request(server)
        .get('/api/v1/surveys/summary?surveyId=latest')
        .set('Authorization', `Bearer ${adminJwt}`)
        .expect(400);
    });
  });

  /** One logged send, as eventa-worker's delivery log records it. */
  async function seedAsked(event: string, email: string): Promise<void> {
    await pool.query(
      `INSERT INTO message_deliveries (organization_id, event_id, kind, recipient_email,
                                       recipient_name, status, sent_at)
       VALUES ($1, $2, $3, $4, 'Anong Pattana', 'sent', now())`,
      [orgId, event, THANK_YOU, email],
    );
  }

  async function seedOrder(event: string, email: string): Promise<void> {
    seq += 1;
    await pool.query(
      `INSERT INTO orders (organization_id, reference, event_id, buyer_name, buyer_email,
                           status, payment_status, seats, subtotal_satang,
                           vat_amount_satang, total_satang, registered_at)
       VALUES ($1,$2,$3,'Anong Pattana',$4,'confirmed','paid',1,0,0,0, now())`,
      [orgId, `ORD-NPS-${seq}`, event, email],
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

async function seedOrg(pool: Pool): Promise<number> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
    [ORG.name, ORG.slug],
  );
  const orgId = Number(res.rows[0].id);
  const grants = ['evCreate'];
  for (const key of grants) {
    await pool.query(
      `INSERT INTO permissions (key, "group", label) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO NOTHING`,
      [key, PERM_GROUP[key], key],
    );
  }
  const role = await pool.query<{ id: string }>(
    `INSERT INTO roles (organization_id, name, description) VALUES ($1, 'Admin', 'seed') RETURNING id`,
    [orgId],
  );
  const roleId = Number(role.rows[0].id);
  for (const key of grants) {
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_key, granted) VALUES ($1, $2, true)`,
      [roleId, key],
    );
  }
  const passwordHash = await hash(PASSWORD);
  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
     VALUES ($1, 'Anan Suksawat', $2, 'admin', 'Active', $3) RETURNING id`,
    [orgId, ADMIN, passwordHash],
  );
  await pool.query(
    `INSERT INTO memberships (organization_id, user_id, role_id, role, status)
     VALUES ($1, $2, $3, 'Admin', 'Active')`,
    [orgId, user.rows[0].id, roleId],
  );
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
  for (const table of [
    'audit_events',
    'outbox_events',
    'message_deliveries',
    'survey_answers',
    'survey_responses',
    'survey_questions',
    'surveys',
    'orders',
    'events',
  ]) {
    await pool.query(
      `DELETE FROM ${table} WHERE organization_id IN
         (SELECT id FROM organizations WHERE slug = $1)`,
      [ORG.slug],
    );
  }
  await pool.query(`DELETE FROM organizations WHERE slug = $1`, [ORG.slug]);
  // The attendees live in the platform org, so the cascade above misses them.
  await pool.query(`DELETE FROM users WHERE email = ANY($1)`, [ATTENDEES]);
}
