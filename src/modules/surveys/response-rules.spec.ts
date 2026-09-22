import { DomainException } from '../../common/errors/domain.exception';
import { assertAnswers, completionOf, summarise } from './response-rules';

const questions = [
  { id: 1, type: 'rating' as const, prompt: 'How was it?', options: [] },
  { id: 2, type: 'text' as const, prompt: 'Anything else?', options: [] },
  {
    id: 3,
    type: 'choice' as const,
    prompt: 'Best bit?',
    options: ['Keynote', 'Panel'],
  },
];

const answers = [
  { questionId: 1, rating: 5 },
  { questionId: 3, choice: 'Panel' },
];

describe('answering a survey (US-MSG-08)', () => {
  it('accepts a rating and a choice, with the free text left out', () => {
    // Text is the one kind nobody should be forced to write.
    expect(() => assertAnswers(questions, answers)).not.toThrow();
  });

  it('insists on the rating', () => {
    expect(() =>
      assertAnswers(questions, [{ questionId: 3, choice: 'Panel' }]),
    ).toThrow(/How was it/);
  });

  it('insists on the choice', () => {
    expect(() =>
      assertAnswers(questions, [{ questionId: 1, rating: 5 }]),
    ).toThrow(/Best bit/);
  });

  it('refuses a rating outside the scale', () => {
    // A 7 out of 5 would quietly drag every average it touches upward.
    expect(() =>
      assertAnswers(questions, [
        ...answers.slice(1),
        { questionId: 1, rating: 7 },
      ]),
    ).toThrow(DomainException);
    expect(() =>
      assertAnswers(questions, [
        ...answers.slice(1),
        { questionId: 1, rating: 0 },
      ]),
    ).toThrow(DomainException);
  });

  it('refuses a choice that was never offered', () => {
    // Free text arriving in a choice column makes the breakdown meaningless.
    expect(() =>
      assertAnswers(questions, [
        { questionId: 1, rating: 4 },
        { questionId: 3, choice: 'Something else' },
      ]),
    ).toThrow(/offered/i);
  });

  it('refuses an answer to a question that is not on this survey', () => {
    expect(() =>
      assertAnswers(questions, [...answers, { questionId: 99, rating: 3 }]),
    ).toThrow(DomainException);
  });
});

describe('answering a recommendation question (US-MSG-08)', () => {
  const withNps = [
    ...questions,
    {
      id: 4,
      type: 'nps' as const,
      prompt: 'How likely are you to recommend us?',
      options: [],
    },
  ];
  const npsOf = (score: number) => [...answers, { questionId: 4, score }];

  it('accepts 0, which is an answer and not a missing one', () => {
    expect(() => assertAnswers(withNps, npsOf(0))).not.toThrow();
  });

  it('accepts 10', () => {
    expect(() => assertAnswers(withNps, npsOf(10))).not.toThrow();
  });

  it('insists on the score', () => {
    // A score half the room skipped measures who bothered, not who would
    // recommend it.
    expect(() => assertAnswers(withNps, answers)).toThrow(/recommend us/);
  });

  it('refuses a score off the 0–10 scale, or between its points', () => {
    for (const score of [11, -1, 7.5]) {
      expect(() => assertAnswers(withNps, npsOf(score))).toThrow(/0 to 10/);
    }
  });

  it('refuses a recommendation answered as a star rating', () => {
    // A 9 in the rating column would land in the average, not the NPS.
    expect(() =>
      assertAnswers(withNps, [...answers, { questionId: 4, rating: 5 }]),
    ).toThrow(DomainException);
  });
});

describe('the same question answered twice (US-MSG-08)', () => {
  const withNps = [
    ...questions,
    {
      id: 4,
      type: 'nps' as const,
      prompt: 'How likely are you to recommend us?',
      options: [],
    },
  ];

  it('refuses a second recommendation score from the same person', () => {
    // Thirty 10s in one response would outvote three honest detractors.
    const stuffed = Array.from({ length: 30 }, () => ({
      questionId: 4,
      score: 10,
    }));
    expect(() => assertAnswers(withNps, [...answers, ...stuffed])).toThrow(
      '“How likely are you to recommend us?” was answered twice.',
    );
  });

  it('refuses a second star rating from the same person', () => {
    expect(() =>
      assertAnswers(questions, [...answers, { questionId: 1, rating: 5 }]),
    ).toThrow(/How was it.*answered twice/);
  });

  it('refuses a second free-text answer too', () => {
    // Nothing is averaged from text, but one person is still one answer.
    expect(() =>
      assertAnswers(questions, [
        ...answers,
        { questionId: 2, answerText: 'Great' },
        { questionId: 2, answerText: 'Really great' },
      ]),
    ).toThrow(DomainException);
  });
});

describe('a value meant for a different kind of question (US-MSG-08)', () => {
  it('refuses a score sent with a star rating', () => {
    // Stored, it would count in the NPS through a question that never asked
    // for one.
    expect(() =>
      assertAnswers(questions, [
        { questionId: 1, rating: 5, score: 9 },
        answers[1],
      ]),
    ).toThrow(/How was it/);
  });

  it('refuses a rating sent with a choice', () => {
    expect(() =>
      assertAnswers(questions, [
        answers[0],
        { questionId: 3, choice: 'Panel', rating: 2 },
      ]),
    ).toThrow(/Best bit/);
  });
});

describe('what a pile of responses adds up to (US-MSG-08)', () => {
  it('averages the ratings and counts each star', () => {
    const summary = summarise([5, 4, 5, 3]);
    expect(summary.average).toBe(4.3);
    expect(summary.distribution).toEqual({ 5: 2, 4: 1, 3: 1, 2: 0, 1: 0 });
  });

  it('has no average when nobody has rated anything', () => {
    // Not 0. Nought out of five is a verdict; this is the absence of one.
    const summary = summarise([]);
    expect(summary.average).toBeNull();
    expect(summary.distribution).toEqual({ 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 });
  });
});

describe('how many of those asked answered (US-MSG-08)', () => {
  it('has no completion rate when nobody was asked', () => {
    // Not 0%. Nobody failing to answer and nobody being asked are different
    // facts: the thank-you was switched off, or never went.
    expect(completionOf({ asked: 0, answered: 0 })).toEqual({
      asked: 0,
      completionRate: null,
    });
  });

  it('is a whole-number percentage of those asked', () => {
    expect(completionOf({ asked: 20, answered: 9 }).completionRate).toBe(45);
    expect(completionOf({ asked: 3, answered: 1 }).completionRate).toBe(33);
  });

  it('reports nought of those asked as a real 0%', () => {
    // Everybody asked and nobody answered is exactly what the figure is for.
    expect(completionOf({ asked: 10, answered: 0 })).toEqual({
      asked: 10,
      completionRate: 0,
    });
  });
});
