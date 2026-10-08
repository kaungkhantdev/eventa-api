import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import {
  orders,
  surveyAnswers,
  surveyQuestions,
  surveyResponses,
  surveys,
  users,
} from '../../db/schema';
import { withTenant } from '../../db/tenant';
import { POST_EVENT_THANKYOU_SLUG } from '../message-templates/message-template-catalog';
import type {
  AnsweredQuestion,
  Reach,
  SubmittedAnswer,
} from './response-rules';

const CONFIRMED = 'confirmed';
/** A delivery the transport accepted. A 'failed' one asked nobody anything. */
const SENT = 'sent';

/** A type alias, not an interface: `execute<T>` wants a Record. */
type ReachRow = { asked: number; answered: number };

/**
 * Which answers a feedback figure is taken over: the whole workspace, one
 * event, or one survey. Every figure in a summary reads the same scope.
 */
export interface FeedbackScope {
  eventId?: string;
  surveyId?: number;
}

export interface LiveSurvey {
  id: number;
  organizationId: number;
  eventId: string;
  title: string;
  questions: AnsweredQuestion[];
}

export interface ResponseRow {
  id: string;
  surveyId: string;
  surveyTitle: string;
  personName: string;
  submittedAt: Date;
  rating: number | null;
  comment: string | null;
}

/**
 * The attendee half of feedback, and the organizer's read of it.
 *
 * The attendee queries are deliberately CROSS-TENANT, like the rest of the
 * portal: somebody's events span every workspace on the platform, so the scope
 * is the person rather than an organization. The write is the exception — by
 * then the survey has named its workspace, so the row goes in under it.
 */
@Injectable()
export class SurveyResponsesRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * The live survey for an event this person actually attended.
   *
   * The attendance check is the gate: without it anyone holding a link could
   * rate an event they never went to, and a satisfaction figure built from
   * strangers is worse than none.
   */
  async liveSurveyFor(
    eventId: string,
    email: string,
  ): Promise<LiveSurvey | undefined> {
    const [attended] = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.eventId, eventId),
          eq(orders.buyerEmail, email),
          eq(orders.status, CONFIRMED),
          isNull(orders.deletedAt),
        ),
      )
      .limit(1);
    if (!attended) return undefined;

    const [survey] = await this.db
      .select({
        id: surveys.id,
        organizationId: surveys.organizationId,
        eventId: surveys.eventId,
        title: surveys.title,
      })
      .from(surveys)
      .where(and(eq(surveys.eventId, eventId), eq(surveys.status, 'live')))
      .orderBy(asc(surveys.id))
      .limit(1);
    if (!survey) return undefined;

    const questions = await this.db
      .select({
        id: surveyQuestions.id,
        type: surveyQuestions.type,
        prompt: surveyQuestions.prompt,
        options: surveyQuestions.options,
      })
      .from(surveyQuestions)
      .where(eq(surveyQuestions.surveyId, survey.id))
      .orderBy(asc(surveyQuestions.position), asc(surveyQuestions.id));

    return { ...survey, questions };
  }

  /** Whether this person has already answered — one response each. */
  async hasAnswered(surveyId: number, userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: surveyResponses.id })
      .from(surveyResponses)
      .where(
        and(
          eq(surveyResponses.surveyId, surveyId),
          eq(surveyResponses.userId, userId),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  /** Response and answers together — half a response is not one. */
  async submit(
    survey: LiveSurvey,
    userId: string,
    answers: SubmittedAnswer[],
    submittedAt: Date,
  ): Promise<void> {
    await withTenant(this.db, survey.organizationId, async (tx) => {
      const [response] = await tx
        .insert(surveyResponses)
        .values({
          organizationId: survey.organizationId,
          surveyId: survey.id,
          eventId: survey.eventId,
          userId,
          submittedAt,
        })
        .returning({ id: surveyResponses.id });

      if (answers.length === 0) return;
      await tx.insert(surveyAnswers).values(
        answers.map((answer) => ({
          organizationId: survey.organizationId,
          responseId: response.id,
          questionId: answer.questionId,
          rating: answer.rating ?? null,
          answerText: answer.answerText?.trim() || null,
          choice: answer.choice ?? null,
          score: answer.score ?? null,
        })),
      );
    });
  }

  /**
   * How many people answered in scope — one response each, whatever it held
   * (US-MSG-08). Not the ratings: a recommendation-only survey has none, and a
   * survey with two star questions has two per person.
   */
  respondentsFor(
    organizationId: number,
    scope: FeedbackScope,
  ): Promise<number> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({ count: sql<string>`count(*)` })
        .from(surveyResponses)
        .where(
          and(
            eq(surveyResponses.organizationId, organizationId),
            scope.eventId
              ? eq(surveyResponses.eventId, scope.eventId)
              : undefined,
            scope.surveyId
              ? eq(surveyResponses.surveyId, scope.surveyId)
              : undefined,
          ),
        );
      return Number(row?.count ?? 0);
    });
  }

  /** Every rating given in scope, for the averages and the breakdown. */
  ratingsFor(organizationId: number, scope: FeedbackScope): Promise<number[]> {
    return withTenant(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select({ rating: surveyAnswers.rating })
        .from(surveyAnswers)
        .innerJoin(
          surveyResponses,
          eq(surveyResponses.id, surveyAnswers.responseId),
        )
        .where(
          and(
            ...inScope(organizationId, scope),
            sql`${surveyAnswers.rating} is not null`,
          ),
        );
      return rows.map((row) => Number(row.rating));
    });
  }

  /**
   * Every recommendation score given in scope, for the NPS (US-MSG-08).
   *
   * Pooled answer by answer, so a workspace-wide figure weighs each event by
   * how many answered it — US-MSG-08's "weighted by responses".
   */
  npsScoresFor(
    organizationId: number,
    scope: FeedbackScope,
  ): Promise<number[]> {
    return withTenant(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select({ score: surveyAnswers.score })
        .from(surveyAnswers)
        .innerJoin(
          surveyResponses,
          eq(surveyResponses.id, surveyAnswers.responseId),
        )
        .where(
          and(
            ...inScope(organizationId, scope),
            isNotNull(surveyAnswers.score),
          ),
        );
      return rows.map((row) => Number(row.score));
    });
  }

  /**
   * Who the post-event thank-you reached, and how many of THEM answered
   * (US-MSG-08) — for one event, or pooled across the workspace.
   *
   * The unit is one person per event, matched on (event, address): an answer
   * about one event never completes another, and somebody who answered without
   * being emailed is not in `answered` at all, so it can never exceed `asked`.
   *
   * Across the workspace the pairs are simply pooled, so each event weighs by
   * how many it asked. US-MSG-08's note weights portfolio figures by
   * responses; that suits an average rating, not this: an event where everyone
   * was asked and nobody answered is exactly what completion measures, and
   * weighting by responses would drop it and flatter the rate.
   *
   * - DISTINCT in `asked`, because one person can hold several 'sent'
   *   thank-yous for an event: a run eventa-worker never completed (one address
   *   failing for good) is resumed hourly through the feedback window, and once
   *   its per-event recipient ledger lapses it mails everybody again. Nothing
   *   in message_deliveries forbids the repeat. (A failed row needs no DISTINCT:
   *   the status filter already drops it.)
   * - DISTINCT in `answered`, because one person can answer more than one
   *   survey of an event — an event may have several, a closed one can reopen,
   *   and "once each" is per survey. Without it the LEFT JOIN repeats that
   *   person's asked row, swelling `asked` and skewing the rate.
   * - lower() on both sides, because `recipient_email` is plain text holding
   *   the BUYER's spelling of the address while `users.email` is citext. Without
   *   it "Anan@…" asked and "anan@…" answering would never meet.
   *
   * Scoped to one survey, both halves are that survey's: asked is the
   * thank-you for ITS event, and answered is answers to IT. A second survey of
   * the same event is not completed by somebody answering the first.
   *
   * Literal SQL with explicit aliases: Drizzle drops table qualifiers from
   * interpolated columns inside a CTE, so only values are interpolated here.
   */
  reachFor(organizationId: number, scope: FeedbackScope): Promise<Reach> {
    const { eventId, surveyId } = scope;
    const deliveryEvent = eventId ? sql`AND d.event_id = ${eventId}` : sql``;
    const responseEvent = eventId ? sql`AND r.event_id = ${eventId}` : sql``;
    const deliverySurvey = surveyId
      ? sql`AND d.event_id = (SELECT s.event_id FROM surveys s
                               WHERE s.id = ${surveyId}
                                 AND s.organization_id = ${organizationId})`
      : sql``;
    const responseSurvey = surveyId
      ? sql`AND r.survey_id = ${surveyId}`
      : sql``;
    return withTenant(this.db, organizationId, async (tx) => {
      const result = await tx.execute<ReachRow>(sql`
        WITH asked AS (
          SELECT DISTINCT d.event_id, lower(d.recipient_email) AS email
          FROM message_deliveries d
          WHERE d.organization_id = ${organizationId}
            AND d.kind = ${POST_EVENT_THANKYOU_SLUG}
            AND d.status = ${SENT}
            AND d.event_id IS NOT NULL
            ${deliveryEvent}
            ${deliverySurvey}
        ),
        answered AS (
          SELECT DISTINCT r.event_id, lower(u.email) AS email
          FROM survey_responses r
          JOIN users u ON u.id = r.user_id
          WHERE r.organization_id = ${organizationId}
            ${responseEvent}
            ${responseSurvey}
        )
        SELECT count(*)::int AS asked, count(ans.email)::int AS answered
        FROM asked a
        LEFT JOIN answered ans
          ON ans.event_id = a.event_id AND ans.email = a.email
      `);
      const row = result.rows[0];
      return {
        asked: Number(row?.asked ?? 0),
        answered: Number(row?.answered ?? 0),
      };
    });
  }

  /** How many people answered, per event. */
  countsByEvent(
    organizationId: number,
  ): Promise<{ eventId: string; responses: number }[]> {
    return withTenant(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select({
          eventId: surveyResponses.eventId,
          responses: sql<string>`count(*)`,
        })
        .from(surveyResponses)
        .where(eq(surveyResponses.organizationId, organizationId))
        .groupBy(surveyResponses.eventId);
      return rows.map((row) => ({
        eventId: row.eventId,
        responses: Number(row.responses),
      }));
    });
  }

  /**
   * Individual responses for one event (US-MSG-10), newest first.
   *
   * The rating and the comment are lifted out of the answers so a row reads as
   * "who, how they scored it, what they said" — which is how somebody skims
   * feedback. The rest of the answers stay where they are.
   */
  list(
    organizationId: number,
    eventId: string,
    filter: { rating?: number; limit: number },
  ): Promise<ResponseRow[]> {
    return withTenant(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select({
          id: surveyResponses.id,
          surveyId: surveyResponses.surveyId,
          surveyTitle: surveys.title,
          personName: users.name,
          submittedAt: surveyResponses.submittedAt,
          rating: sql<
            number | null
          >`(select a.rating from survey_answers a where a.response_id = survey_responses.id and a.rating is not null limit 1)`,
          comment: sql<
            string | null
          >`(select a.answer_text from survey_answers a where a.response_id = survey_responses.id and a.answer_text is not null limit 1)`,
        })
        .from(surveyResponses)
        .innerJoin(surveys, eq(surveys.id, surveyResponses.surveyId))
        .innerJoin(users, eq(users.id, surveyResponses.userId))
        .where(
          and(
            eq(surveyResponses.organizationId, organizationId),
            eq(surveyResponses.eventId, eventId),
          ),
        )
        .orderBy(desc(surveyResponses.submittedAt), desc(surveyResponses.id))
        .limit(filter.limit);

      return rows
        .map((row) => ({
          ...row,
          id: String(row.id),
          surveyId: String(row.surveyId),
          rating: row.rating === null ? null : Number(row.rating),
        }))
        .filter((row) => !filter.rating || row.rating === filter.rating);
    });
  }
}

/**
 * The answers a figure is taken over. Filtered on the RESPONSE's event and
 * survey — each answer's response says what it was about.
 */
function inScope(organizationId: number, scope: FeedbackScope) {
  return [
    eq(surveyAnswers.organizationId, organizationId),
    scope.eventId ? eq(surveyResponses.eventId, scope.eventId) : undefined,
    scope.surveyId ? eq(surveyResponses.surveyId, scope.surveyId) : undefined,
  ];
}
