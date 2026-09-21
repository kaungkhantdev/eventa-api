import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idPk, updatedAt } from './_columns';
import { surveyQuestionTypeEnum, surveyStatusEnum } from './enums';
import { users } from './identity';
import { organizations } from './organizations';

/**
 * A feedback survey an organizer wrote for one event (US-MSG-09).
 *
 * Belongs to an EVENT, not to the workspace: "how was it?" is a question about
 * something that happened, and a survey with no event has nobody to ask.
 *
 * A draft collects nothing. That is the whole reason the status exists — a
 * survey has to be writable before it is exposed to attendees, and half-written
 * questions reaching somebody's inbox is the failure this prevents.
 */
export const surveys = pgTable(
  'surveys',
  {
    id: idPk(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    eventId: uuid().notNull(),
    title: text().notNull(),
    status: surveyStatusEnum().notNull().default('draft'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('ix_surveys_org_event').on(t.organizationId, t.eventId)],
);

/**
 * One question on a survey (US-MSG-09).
 *
 * `position` orders them; it is not unique, because reordering a list under a
 * unique constraint means either a temporary duplicate or a dance through
 * negative numbers. The read orders by it and breaks ties on id.
 *
 * `options` is only meaningful for a `choice` question, and such a question is
 * invalid with fewer than two — a choice between one thing is not a choice.
 * That rule is enforced in the service, where it can say so in a sentence.
 */
export const surveyQuestions = pgTable(
  'survey_questions',
  {
    id: idPk(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    surveyId: bigint({ mode: 'number' })
      .notNull()
      .references(() => surveys.id, { onDelete: 'cascade' }),
    position: integer().notNull(),
    type: surveyQuestionTypeEnum().notNull(),
    prompt: text().notNull(),
    options: text().array().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('ix_survey_questions_survey').on(t.surveyId, t.position)],
);

/**
 * One attendee's completed survey (US-MSG-08/10).
 *
 * Signed-in only, and UNIQUE per (survey, person). An anonymous link would let
 * anyone with the URL push an event's rating wherever they liked, and a
 * satisfaction figure that can be stuffed is worse than no figure — an
 * organizer would act on it.
 *
 * Cascades from the user: deleting an account takes their feedback with it,
 * which is both what account deletion should mean and what keeps "one response
 * per person" true rather than leaving an orphan nobody can attribute.
 */
export const surveyResponses = pgTable(
  'survey_responses',
  {
    id: idPk(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    surveyId: bigint({ mode: 'number' })
      .notNull()
      .references(() => surveys.id, { onDelete: 'cascade' }),
    /** Denormalised from the survey so an event's figures are one join fewer. */
    eventId: uuid().notNull(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    submittedAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('uq_survey_responses_person').on(t.surveyId, t.userId),
    index('ix_survey_responses_org_event').on(t.organizationId, t.eventId),
  ],
);

/**
 * One answer within a response (US-MSG-10).
 *
 * Three columns, one per question type, and exactly one is filled. A single
 * `value` text column would have meant parsing "4" back into a number every
 * time an average was taken, and an average is the whole point of a rating.
 */
export const surveyAnswers = pgTable(
  'survey_answers',
  {
    id: idPk(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    responseId: bigint({ mode: 'number' })
      .notNull()
      .references(() => surveyResponses.id, { onDelete: 'cascade' }),
    questionId: bigint({ mode: 'number' })
      .notNull()
      .references(() => surveyQuestions.id, { onDelete: 'cascade' }),
    /** 1–5, for a `rating` question. */
    rating: integer(),
    /** For a `text` question. */
    answerText: text(),
    /** The option chosen, for a `choice` question. */
    choice: text(),
    createdAt: createdAt(),
  },
  (t) => [index('ix_survey_answers_response').on(t.responseId)],
);
