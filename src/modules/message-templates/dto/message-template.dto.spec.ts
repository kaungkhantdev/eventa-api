import { DECORATORS } from '@nestjs/swagger';
import { TEMPLATE_DELIVERY } from '../message-template-catalog';
import { MessageTemplateDto } from './message-template.dto';

/**
 * The prose beside `delivery` has to agree with the vocabulary it documents.
 *
 * `openapi.json` is this project's stated contract with `../eventa-web`, and a
 * description is the one part of that contract nothing else in this repo can
 * police. The `enum` becomes a union a generated client's compiler enforces,
 * while the sentence next to it is read by people — so a state named in the
 * sentence but absent from the enum is invisible to `tsc`, to the mapper and
 * to the service, and the reader is the only one misled. A field that offers
 * three states where the API accepts two sends somebody to build against a
 * value nobody can ever send. These tests make the prose answerable to
 * `TEMPLATE_DELIVERY`.
 *
 * This is deliberately not a test of wording. It asserts only WHICH states the
 * sentence names, so the copy itself stays free to change.
 */

/** The slice of one `@ApiProperty`'s metadata this file reads. */
interface PublishedProperty {
  readonly enum?: readonly string[];
  readonly description?: string;
}

const publishedProperty = (
  property: keyof MessageTemplateDto,
): PublishedProperty =>
  (Reflect.getMetadata(
    DECORATORS.API_MODEL_PROPERTIES,
    MessageTemplateDto.prototype,
    property,
  ) ?? {}) as PublishedProperty;

/** Every `backticked` token in a description, deduplicated, in order of use. */
const statesNamedInProse = (description: string): string[] => [
  ...new Set([...description.matchAll(/`([^`]+)`/g)].map((match) => match[1])),
];

/**
 * Widened to `string[]` on purpose. The question these tests ask is whether an
 * arbitrary token the prose used belongs to the vocabulary, and the narrow
 * `readonly ['controlled', 'planned']` refuses to be asked that about anything
 * outside itself — which is exactly the token we need to catch.
 */
const DELIVERY_VOCABULARY: readonly string[] = TEMPLATE_DELIVERY;

describe('MessageTemplateDto — the published `delivery` contract', () => {
  const delivery = publishedProperty('delivery');

  it('publishes exactly the vocabulary the catalog defines', () => {
    expect(delivery.enum).toEqual([...TEMPLATE_DELIVERY]);
  });

  it('names no delivery state the enum does not publish', () => {
    const named = statesNamedInProse(delivery.description ?? '');

    expect(
      named.filter((state) => !DELIVERY_VOCABULARY.includes(state)),
    ).toEqual([]);
  });

  it('explains every delivery state the enum does publish', () => {
    const named = statesNamedInProse(delivery.description ?? '');

    expect(
      DELIVERY_VOCABULARY.filter((state) => !named.includes(state)),
    ).toEqual([]);
  });
});
