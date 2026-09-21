import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
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
import type { AnsweredQuestion, SubmittedAnswer } from './response-rules';

const CONFIRMED = 'confirmed';

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
        })),
      );
    });
  }

  /** Every rating given for an event, for the averages and the breakdown. */
  ratingsFor(organizationId: number, eventId?: string): Promise<number[]> {
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
            eq(surveyAnswers.organizationId, organizationId),
            eventId ? eq(surveyResponses.eventId, eventId) : undefined,
            sql`${surveyAnswers.rating} is not null`,
          ),
        );
      return rows.map((row) => Number(row.rating));
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
