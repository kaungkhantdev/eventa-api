import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';

/** Words that read as a promotion and survive being typed off a poster. */
const WORDS = [
  'PROMO',
  'SAVE',
  'EARLY',
  'BONUS',
  'TREAT',
  'FRIEND',
  'WELCOME',
  'THANKS',
  'CHEER',
  'BOOST',
  'SPARK',
  'LUCKY',
] as const;

const MIN_SUFFIX = 10;
const MAX_SUFFIX = 100; // exclusive → always two digits
/** After this many collisions, widen the suffix rather than spin forever. */
const ATTEMPTS_BEFORE_WIDENING = 40;
const WIDE_SUFFIX_MAX = 100_000;

/**
 * Proposes a memorable, unused code (US-TKT-07) — "PROMO42" rather than a random
 * string nobody can read back over the phone.
 *
 * It is handed the codes already in use and never returns one of them, so
 * pressing Generate repeatedly always moves forward. Once the short vocabulary is
 * exhausted it widens the numeric suffix instead of failing, so the button keeps
 * working in a workspace running hundreds of promotions.
 */
@Injectable()
export class DiscountCodeGenerator {
  generate(taken: ReadonlySet<string>): string {
    for (let attempt = 0; attempt < ATTEMPTS_BEFORE_WIDENING; attempt++) {
      const code = `${pick(WORDS)}${randomInt(MIN_SUFFIX, MAX_SUFFIX)}`;
      if (!taken.has(code)) return code;
    }
    // Vocabulary is crowded — go wider rather than give up.
    for (;;) {
      const code = `${pick(WORDS)}${randomInt(MIN_SUFFIX, WIDE_SUFFIX_MAX)}`;
      if (!taken.has(code)) return code;
    }
  }
}

function pick<T>(items: readonly T[]): T {
  return items[randomInt(0, items.length)];
}
