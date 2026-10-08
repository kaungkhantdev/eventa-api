import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { surveyQuestions, surveys } from '../../db/schema';
import { withTenant, type Tx } from '../../db/tenant';
import type { DraftQuestion, SurveyStatus } from './survey-rules';

export type SurveyRow = typeof surveys.$inferSelect;
export type SurveyQuestionRow = typeof surveyQuestions.$inferSelect;

export interface SurveyWithQuestions extends SurveyRow {
  questions: SurveyQuestionRow[];
}

export interface NewSurvey {
  eventId: string;
  title: string;
  questions: DraftQuestion[];
}

/** Data access for survey authoring (US-MSG-09). */
@Injectable()
export class SurveysRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  list(
    organizationId: number,
    eventId?: string,
  ): Promise<SurveyWithQuestions[]> {
    return withTenant(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select()
        .from(surveys)
        .where(
          and(
            eq(surveys.organizationId, organizationId),
            eventId ? eq(surveys.eventId, eventId) : undefined,
          ),
        )
        .orderBy(asc(surveys.id));
      return this.withQuestions(tx, rows);
    });
  }

  byId(
    organizationId: number,
    surveyId: number,
  ): Promise<SurveyWithQuestions | undefined> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select()
        .from(surveys)
        .where(
          and(
            eq(surveys.organizationId, organizationId),
            eq(surveys.id, surveyId),
          ),
        )
        .limit(1);
      if (!row) return undefined;
      const [withQuestions] = await this.withQuestions(tx, [row]);
      return withQuestions;
    });
  }

  /**
   * Survey and questions in ONE transaction. A survey that committed without
   * its questions is exactly the "survey nobody can answer" the rules refuse.
   */
  create(organizationId: number, input: NewSurvey): Promise<number> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .insert(surveys)
        .values({
          organizationId,
          eventId: input.eventId,
          title: input.title.trim(),
        })
        .returning({ id: surveys.id });
      await this.writeQuestions(tx, organizationId, row.id, input.questions);
      return row.id;
    });
  }

  /**
   * Replace the whole question set rather than diffing it.
   *
   * The editor hands over the survey as it should now be, and matching that up
   * against what is stored — which moved, which is new, which went — is a
   * reconciliation with several ways to be subtly wrong. Replacing is one
   * statement and cannot half-apply. It is safe precisely because answers live
   * in their own tables and never point at a question row.
   */
  update(
    organizationId: number,
    surveyId: number,
    input: { title: string; questions: DraftQuestion[] },
  ): Promise<void> {
    return withTenant(this.db, organizationId, async (tx) => {
      await tx
        .update(surveys)
        .set({ title: input.title.trim(), updatedAt: new Date() })
        .where(
          and(
            eq(surveys.organizationId, organizationId),
            eq(surveys.id, surveyId),
          ),
        );
      await tx
        .delete(surveyQuestions)
        .where(
          and(
            eq(surveyQuestions.organizationId, organizationId),
            eq(surveyQuestions.surveyId, surveyId),
          ),
        );
      await this.writeQuestions(tx, organizationId, surveyId, input.questions);
    });
  }

  async setStatus(
    organizationId: number,
    surveyId: number,
    status: SurveyStatus,
  ): Promise<void> {
    await withTenant(this.db, organizationId, async (tx) => {
      await tx
        .update(surveys)
        .set({ status, updatedAt: new Date() })
        .where(
          and(
            eq(surveys.organizationId, organizationId),
            eq(surveys.id, surveyId),
          ),
        );
    });
  }

  async remove(organizationId: number, surveyId: number): Promise<void> {
    await withTenant(this.db, organizationId, async (tx) => {
      await tx
        .delete(surveys)
        .where(
          and(
            eq(surveys.organizationId, organizationId),
            eq(surveys.id, surveyId),
          ),
        );
    });
  }

  private async withQuestions(
    tx: Tx,
    rows: SurveyRow[],
  ): Promise<SurveyWithQuestions[]> {
    if (rows.length === 0) return [];
    const questions = await tx
      .select()
      .from(surveyQuestions)
      .where(
        inArray(
          surveyQuestions.surveyId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(asc(surveyQuestions.position), asc(surveyQuestions.id));
    return rows.map((row) => ({
      ...row,
      questions: questions.filter((q) => q.surveyId === row.id),
    }));
  }

  private async writeQuestions(
    tx: Tx,
    organizationId: number,
    surveyId: number,
    questions: DraftQuestion[],
  ): Promise<void> {
    if (questions.length === 0) return;
    await tx.insert(surveyQuestions).values(
      questions.map((question, index) => ({
        organizationId,
        surveyId,
        position: index,
        type: question.type,
        prompt: question.prompt.trim(),
        // Only a choice question keeps options; storing them on a rating would
        // resurrect them if its type were ever switched back.
        options:
          question.type === 'choice'
            ? question.options.map((option) => option.trim())
            : [],
      })),
    );
  }
}
