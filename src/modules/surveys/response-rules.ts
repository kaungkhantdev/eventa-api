import { DomainException } from '../../common/errors/domain.exception';
import type { SurveyQuestionType } from './survey-rules';

/** The scale a rating question is answered on. */
export const MIN_RATING = 1;
export const MAX_RATING = 5;

export interface AnsweredQuestion {
  id: number;
  type: SurveyQuestionType;
  prompt: string;
  options: string[];
}

export interface SubmittedAnswer {
  questionId: number;
  rating?: number;
  answerText?: string;
  choice?: string;
}

/**
 * Whether a submitted set of answers is one this survey can accept
 * (US-MSG-08).
 *
 * Ratings and choices are REQUIRED; free text is not. A number and a chosen
 * option are what the figures are built from, and an average taken over a
 * question half the room skipped says something different from the one an
 * organizer thinks they are reading. Nobody should be made to write prose.
 */
export function assertAnswers(
  questions: AnsweredQuestion[],
  answers: SubmittedAnswer[],
): void {
  const byId = new Map(questions.map((question) => [question.id, question]));

  for (const answer of answers) {
    const question = byId.get(answer.questionId);
    if (!question) {
      throw DomainException.validation(
        'That answer is for a question this survey does not ask.',
      );
    }
    assertShape(question, answer);
  }

  const answered = new Set(answers.map((answer) => answer.questionId));
  for (const question of questions) {
    if (question.type === 'text') continue;
    if (!answered.has(question.id)) {
      throw DomainException.validation(`Please answer “${question.prompt}”.`);
    }
  }
}

function assertShape(
  question: AnsweredQuestion,
  answer: SubmittedAnswer,
): void {
  if (question.type === 'rating') {
    const rating = answer.rating;
    if (
      rating === undefined ||
      !Number.isInteger(rating) ||
      rating < MIN_RATING ||
      rating > MAX_RATING
    ) {
      throw DomainException.validation(
        `“${question.prompt}” is answered from ${MIN_RATING} to ${MAX_RATING}.`,
      );
    }
    return;
  }

  if (question.type === 'choice') {
    if (!answer.choice || !question.options.includes(answer.choice)) {
      throw DomainException.validation(
        `“${question.prompt}” must be one of the options offered.`,
      );
    }
  }
}

export interface RatingSummary {
  responses: number;
  /** Null when nobody has rated anything — never 0, which is a verdict. */
  average: number | null;
  distribution: Record<number, number>;
}

/** One decimal place: the difference between 4.27 and 4.3 is noise. */
const PRECISION = 10;

export function summarise(ratings: number[]): RatingSummary {
  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const rating of ratings) distribution[rating] += 1;

  const total = ratings.reduce((sum, rating) => sum + rating, 0);
  return {
    responses: ratings.length,
    average:
      ratings.length === 0
        ? null
        : Math.round((total / ratings.length) * PRECISION) / PRECISION,
    distribution,
  };
}
