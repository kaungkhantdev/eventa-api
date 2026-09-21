import { DomainException } from '../../common/errors/domain.exception';
import type { surveyQuestionTypeEnum, surveyStatusEnum } from '../../db/schema';

export type SurveyStatus = (typeof surveyStatusEnum.enumValues)[number];
export type SurveyQuestionType =
  (typeof surveyQuestionTypeEnum.enumValues)[number];

export interface DraftQuestion {
  type: SurveyQuestionType;
  prompt: string;
  options: string[];
}

export interface DraftSurvey {
  title: string;
  questions: DraftQuestion[];
}

/** A choice between one thing is not a choice. */
const MIN_OPTIONS = 2;

/**
 * Whether a survey can actually be answered (US-MSG-09).
 *
 * Checked on every save, not only on going live: a draft is still something an
 * organizer comes back to, and telling them at the last moment that question
 * four was never valid is a worse conversation than telling them now.
 *
 * Every refusal names the question it is about. "A question is invalid" is
 * useless on a survey with nine of them.
 */
export function assertAnswerable(survey: DraftSurvey): void {
  if (!survey.title.trim()) {
    throw DomainException.validation('Give the survey a title.');
  }
  if (survey.questions.length === 0) {
    throw DomainException.validation(
      'Add at least one question — a survey nobody can answer is not a survey.',
    );
  }
  survey.questions.forEach((question, index) =>
    assertQuestion(question, index + 1),
  );
}

function assertQuestion(question: DraftQuestion, number: number): void {
  if (!question.prompt.trim()) {
    throw DomainException.validation(
      `Question ${number} has no question in it.`,
    );
  }
  if (question.type !== 'choice') return;

  const options = question.options.filter((option) => option.trim());
  if (options.length !== question.options.length) {
    throw DomainException.validation(
      `Question ${number} has a blank answer option.`,
    );
  }
  if (options.length < MIN_OPTIONS) {
    throw DomainException.validation(
      `Question ${number} needs at least two options to choose between.`,
    );
  }
}

/**
 * The moves a survey may make (US-MSG-09).
 *
 * Nothing returns to `draft`. A survey that has been exposed to attendees
 * cannot become unexposed, and an organizer seeing "Draft" on one that already
 * collected answers would believe it had collected none.
 */
const ALLOWED: Record<SurveyStatus, SurveyStatus[]> = {
  draft: ['live'],
  live: ['closed'],
  closed: ['live'],
};

export function assertTransition(from: SurveyStatus, to: SurveyStatus): void {
  if (ALLOWED[from].includes(to)) return;
  if (from === to) {
    throw DomainException.validation(`This survey is already ${from}.`);
  }
  throw DomainException.validation(`A ${from} survey cannot be made ${to}.`);
}
