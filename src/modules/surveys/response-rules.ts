import { DomainException } from '../../common/errors/domain.exception';
import { MAX_NPS_SCORE, MIN_NPS_SCORE } from './nps-rules';
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
  /** 0–10, answering an `nps` question. */
  score?: number;
}

type AnswerField = keyof Omit<SubmittedAnswer, 'questionId'>;

/** The one field each kind of question is answered in. */
const ANSWER_FIELD: Record<SurveyQuestionType, AnswerField> = {
  rating: 'rating',
  text: 'answerText',
  choice: 'choice',
  nps: 'score',
};

const ANSWER_FIELDS = Object.values(ANSWER_FIELD);

/**
 * Whether a submitted set of answers is one this survey can accept
 * (US-MSG-08).
 *
 * Ratings, recommendation scores and choices are REQUIRED; free text is not. A
 * number and a chosen option are what the figures are built from, and an
 * average taken over a question half the room skipped says something different
 * from the one an organizer thinks they are reading. Nobody should be made to
 * write prose.
 *
 * Each answer carries a value in its own question's field and no other. The
 * figures read a column without asking which question filled it, so a `score`
 * riding along on a rating question would be counted in the NPS, and a
 * `rating` on a recommendation question in the average.
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
  assertOnlyItsOwnField(question, answer);

  if (question.type === 'nps') {
    if (!isOnScale(answer.score, MIN_NPS_SCORE, MAX_NPS_SCORE)) {
      throw DomainException.validation(
        `“${question.prompt}” is answered from ${MIN_NPS_SCORE} to ${MAX_NPS_SCORE}.`,
      );
    }
    return;
  }

  if (question.type === 'rating') {
    if (!isOnScale(answer.rating, MIN_RATING, MAX_RATING)) {
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

function assertOnlyItsOwnField(
  question: AnsweredQuestion,
  answer: SubmittedAnswer,
): void {
  const own = ANSWER_FIELD[question.type];
  const stray = ANSWER_FIELDS.some(
    (field) => field !== own && answer[field] != null,
  );
  if (stray) {
    throw DomainException.validation(
      `“${question.prompt}” was sent an answer meant for a different kind of question.`,
    );
  }
}

function isOnScale(
  value: number | undefined,
  min: number,
  max: number,
): boolean {
  return (
    value !== undefined &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
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

const PERCENT = 100;

/** Who the post-event thank-you reached, and how many of THEM answered. */
export interface Reach {
  asked: number;
  answered: number;
}

export interface Completion {
  asked: number;
  /** Whole percent, null when nobody was asked — never 0. */
  completionRate: number | null;
}

export type FeedbackSummary = RatingSummary & Completion;

/**
 * How many of the people asked answered (US-MSG-08).
 *
 * `answered` counts only respondents who were ASKED — the overlap of "the
 * thank-you reached them" and "they answered", worked out where the rows are.
 * It is a subset of `asked` by construction, so the rate cannot pass 100% and
 * nothing is capped. A cap was the alternative and it lies: ten asked, two of
 * them answering and nine more answering from the portal unprompted would read
 * 100% while eight in ten of those asked ignored it. Those nine still count,
 * under responses; they just do not complete anything they were not asked.
 *
 * Nobody asked is null, not 0%: the thank-you was switched off, or never went,
 * and that is a different fact from everybody ignoring it.
 */
export function completionOf(reach: Reach): Completion {
  return {
    asked: reach.asked,
    completionRate:
      reach.asked === 0
        ? null
        : Math.round((reach.answered / reach.asked) * PERCENT),
  };
}
