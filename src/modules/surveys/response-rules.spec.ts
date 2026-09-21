import { DomainException } from '../../common/errors/domain.exception';
import { assertAnswers, summarise } from './response-rules';

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

describe('what a pile of responses adds up to (US-MSG-08)', () => {
  it('averages the ratings and counts each star', () => {
    const summary = summarise([5, 4, 5, 3]);
    expect(summary.responses).toBe(4);
    expect(summary.average).toBe(4.3);
    expect(summary.distribution).toEqual({ 5: 2, 4: 1, 3: 1, 2: 0, 1: 0 });
  });

  it('has no average when nobody has rated anything', () => {
    // Not 0. Nought out of five is a verdict; this is the absence of one.
    const summary = summarise([]);
    expect(summary.responses).toBe(0);
    expect(summary.average).toBeNull();
  });
});
