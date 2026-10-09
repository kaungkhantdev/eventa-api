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
  /**
   * Replace a survey's title and questions, if nobody else has saved since.
   *
   * Returns false when the version has moved on; the caller 409s. The survey is
   * known to exist by then, because the service reads it first and 404s.
   *
   * **The order of the three statements is the fix.** The questions are stored
   * by replacement — every row deleted, the submitted set re-inserted — so
   * without a version check two organizers editing one survey did not overwrite
   * a title, they deleted each other's questions: whoever saved second wrote
   * back the list their browser had loaded, and the other's addition was gone
   * with no error and nothing in the response to notice.
   *
   * So the compare-and-swap comes FIRST and the delete only happens if it
   * matched. Checking afterwards would report the conflict having already
   * destroyed the rows, and `withTenant` runs this in one transaction, so a
   * rollback would be the only thing standing between a refusal and data loss.
   * The same shape as `TicketingRepository.update`, which this follows.
   */
  update(
    organizationId: number,
    surveyId: number,
    input: { title: string; questions: DraftQuestion[] },
    currentVersion: number,
  ): Promise<boolean> {
    return withTenant(this.db, organizationId, async (tx) => {
      const claimed = await tx
        .update(surveys)
        .set({
          title: input.title.trim(),
          version: currentVersion + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(surveys.organizationId, organizationId),
            eq(surveys.id, surveyId),
            eq(surveys.version, currentVersion),
          ),
        )
        .returning({ id: surveys.id });
      if (claimed.length === 0) return false;

      await tx
        .delete(surveyQuestions)
        .where(
          and(
            eq(surveyQuestions.organizationId, organizationId),
            eq(surveyQuestions.surveyId, surveyId),
          ),
        );
      await this.writeQuestions(tx, organizationId, surveyId, input.questions);
      return true;
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
