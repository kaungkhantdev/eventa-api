import { DomainException } from '../../common/errors/domain.exception';
import { assertAnswerable, assertTransition } from './survey-rules';

const rating = { type: 'rating' as const, prompt: 'How was it?', options: [] };
const choice = {
  type: 'choice' as const,
  prompt: 'Which session?',
  options: ['Keynote', 'Panel'],
};

describe('what makes a survey answerable (US-MSG-09)', () => {
  it('accepts a survey with a title and one question', () => {
    expect(() =>
      assertAnswerable({ title: 'Post-event', questions: [rating] }),
    ).not.toThrow();
  });

  it('refuses one with no questions', () => {
    // A survey nobody can answer is not a survey.
    expect(() =>
      assertAnswerable({ title: 'Post-event', questions: [] }),
    ).toThrow(DomainException);
  });

  it('refuses a blank title', () => {
    expect(() =>
      assertAnswerable({ title: '   ', questions: [rating] }),
    ).toThrow(DomainException);
  });

  it('refuses a question with nothing written in it', () => {
    expect(() =>
      assertAnswerable({
        title: 'Post-event',
        questions: [{ ...rating, prompt: '  ' }],
      }),
    ).toThrow(/question/i);
  });

  it('refuses a choice of one', () => {
    // A choice between one thing is not a choice.
    expect(() =>
      assertAnswerable({
        title: 'Post-event',
        questions: [{ ...choice, options: ['Keynote'] }],
      }),
    ).toThrow(/two/i);
  });

  it('refuses a choice with a blank option', () => {
    expect(() =>
      assertAnswerable({
        title: 'Post-event',
        questions: [{ ...choice, options: ['Keynote', '  '] }],
      }),
    ).toThrow(DomainException);
  });

  it('does not ask a rating question for options', () => {
    // Only `choice` carries them; requiring them everywhere would block a
    // perfectly good star rating.
    expect(() =>
      assertAnswerable({ title: 'Post-event', questions: [rating, choice] }),
    ).not.toThrow();
  });

  it('names WHICH question is wrong', () => {
    // "A question is invalid" is useless on a survey with nine of them.
    expect(() =>
      assertAnswerable({
        title: 'Post-event',
        questions: [rating, { ...choice, options: [] }],
      }),
    ).toThrow(/2/);
  });
});

describe('a survey’s life (US-MSG-09)', () => {
  it('goes live from a draft', () => {
    expect(() => assertTransition('draft', 'live')).not.toThrow();
  });

  it('closes, and reopens again', () => {
    expect(() => assertTransition('live', 'closed')).not.toThrow();
    expect(() => assertTransition('closed', 'live')).not.toThrow();
  });

  it('never goes back to being a draft', () => {
    // A survey that has been exposed to attendees cannot become unexposed, and
    // an organizer reading "Draft" would believe it had collected nothing.
    expect(() => assertTransition('live', 'draft')).toThrow(DomainException);
    expect(() => assertTransition('closed', 'draft')).toThrow(DomainException);
  });

  it('refuses a move that changes nothing', () => {
    expect(() => assertTransition('live', 'live')).toThrow(DomainException);
  });
});
