import { DomainException } from '../../common/errors/domain.exception';

export interface LocaleWording {
  subject: string;
  body: string;
}

export interface Wording {
  en: LocaleWording;
  th: LocaleWording;
}

const LANGUAGE: Record<keyof Wording, string> = {
  en: 'English',
  th: 'Thai',
};

/** `{{ first_name }}` — whitespace inside the braces is what people type. */
const TAG = /\{\{\s*([\w.]+)\s*\}\}/g;

/**
 * Merge fields the text uses that this message cannot fill.
 *
 * Reported as a list, and each one only once: an organizer with two unknown
 * fields and a message saying "unsupported field" has to guess which.
 */
export function unsupportedTags(
  text: string,
  allowed: readonly string[],
): string[] {
  const names = new Set(allowed.map(nameOf));
  const found = new Set<string>();
  for (const match of text.matchAll(TAG)) {
    if (!names.has(match[1])) found.add(`{{${match[1]}}}`);
  }
  return [...found];
}

function nameOf(tag: string): string {
  return tag.replace(/[{}\s]/g, '');
}

/**
 * Whether wording can be saved (US-MSG-02).
 *
 * A language left ENTIRELY empty is fine — the built-in copy is used for it,
 * and nobody should be made to write Thai in order to change their English.
 * What is refused is a half-written one: a subject with no message, or a
 * message with no subject, would send as a blank where a sentence should be.
 *
 * Every refusal names the language it is about, because on a two-tab editor
 * "the message is blank" does not say which tab.
 */
export function assertWording(
  wording: Wording,
  allowed: readonly string[],
): void {
  for (const locale of ['en', 'th'] as const) {
    assertLocale(wording[locale], LANGUAGE[locale], allowed);
  }
}

function assertLocale(
  wording: LocaleWording,
  language: string,
  allowed: readonly string[],
): void {
  const subject = wording.subject.trim();
  const body = wording.body.trim();
  if (!subject && !body) return;

  if (!subject) {
    throw DomainException.validation(
      `The ${language} subject is empty. Write one, or clear the ${language} message to use Eventa's own wording.`,
    );
  }
  if (!body) {
    throw DomainException.validation(
      `The ${language} message is empty. Write one, or clear the ${language} subject to use Eventa's own wording.`,
    );
  }

  const unknown = [
    ...unsupportedTags(subject, allowed),
    ...unsupportedTags(body, allowed),
  ];
  if (unknown.length > 0) {
    throw DomainException.validation(
      `This message cannot fill ${unknown.join(', ')}. Use one of the fields offered, or remove it.`,
    );
  }
}
