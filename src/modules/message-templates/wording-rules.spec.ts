import { DomainException } from '../../common/errors/domain.exception';
import { assertWording, unsupportedTags } from './wording-rules';

const allowed = ['{{first_name}}', '{{event_name}}'];

describe('merge fields an organizer may use (US-MSG-02)', () => {
  it('finds none in text that uses only what is offered', () => {
    expect(
      unsupportedTags('Hi {{first_name}}, {{event_name}} was great', allowed),
    ).toEqual([]);
  });

  it('names every field this message cannot fill', () => {
    // Unnamed, an organizer has to guess which of nine it was.
    expect(
      unsupportedTags('Hi {{nickname}}, see you at {{venue}}', allowed),
    ).toEqual(['{{nickname}}', '{{venue}}']);
  });

  it('reports each unknown field once, however often it appears', () => {
    expect(unsupportedTags('{{x}} {{x}} {{x}}', allowed)).toEqual(['{{x}}']);
  });

  it('is not fooled by whitespace inside the braces', () => {
    // `{{ first_name }}` is what someone types; it must resolve, not be
    // reported as unknown and then silently fail to fill.
    expect(unsupportedTags('Hi {{ first_name }}', allowed)).toEqual([]);
  });
});

describe('saving wording (US-MSG-02)', () => {
  const good = { subject: 'Hi', body: 'Hello {{first_name}}' };

  it('accepts a locale left entirely empty — the built-in copy is used', () => {
    // Nobody should be forced to write Thai to change their English.
    expect(() =>
      assertWording({ en: good, th: { subject: '', body: '' } }, allowed),
    ).not.toThrow();
  });

  it('refuses a subject with a body but nothing to say', () => {
    expect(() =>
      assertWording(
        {
          en: { subject: '', body: 'Something' },
          th: { subject: '', body: '' },
        },
        allowed,
      ),
    ).toThrow(/subject/i);
  });

  it('refuses a body left blank when a subject was written', () => {
    expect(() =>
      assertWording(
        { en: { subject: 'Hi', body: '  ' }, th: { subject: '', body: '' } },
        allowed,
      ),
    ).toThrow(/message/i);
  });

  it('refuses a field the message cannot fill, and names it', () => {
    expect(() =>
      assertWording(
        {
          en: { subject: 'Hi', body: 'Hello {{nickname}}' },
          th: { subject: '', body: '' },
        },
        allowed,
      ),
    ).toThrow(/\{\{nickname\}\}/);
  });

  it('checks the subject for unfillable fields too', () => {
    expect(() =>
      assertWording(
        {
          en: { subject: 'About {{venue}}', body: 'Hi' },
          th: { subject: '', body: '' },
        },
        allowed,
      ),
    ).toThrow(DomainException);
  });

  it('names WHICH language is wrong', () => {
    // On a two-tab editor, "the body is blank" does not say which tab.
    expect(() =>
      assertWording({ en: good, th: { subject: 'สวัสดี', body: '' } }, allowed),
    ).toThrow(/Thai/);
  });
});
