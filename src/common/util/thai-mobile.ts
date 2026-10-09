/**
 * Turns what a member typed into the one shape an SMS provider accepts, or
 * refuses it.
 *
 * This exists because US-DISC-11 AC3 makes the number a credential: a code is
 * texted to it and typed back. A number that cannot receive a text is
 * therefore not merely untidy — it is a dead end, where the member saves,
 * waits, and can never confirm. So the shape has to be decided at the edge
 * that accepts it rather than in the worker that eventually sends.
 *
 * Thailand only, because that is the only country this product texts. A `+1`
 * or `+65` is a real mobile; it just is not one Eventa has decided how to
 * reach, and refusing it out loud beats accepting it and silently never
 * sending.
 *
 * eventa-worker has its own `toThaiMobileE164` doing the same job on the
 * receiving side — the two repos share no package by design, and the worker
 * must stay able to refuse a number that reached it from somewhere other than
 * this form (a checkout field still stores raw text). Normalising here makes
 * that copy a pass-through for confirmed profile numbers rather than the only
 * line of defence.
 */

/** Thailand. The only country this product texts today. */
const COUNTRY_CODE = '66';

/** A Thai national subscriber number, after the trunk zero: 9 digits. */
const NATIONAL_DIGITS = 9;

/**
 * The first digit of a Thai MOBILE number once the trunk zero is off: 06, 08
 * and 09 are mobile ranges. Everything else (02 Bangkok, 03x–05x, 07x) is a
 * landline, which cannot receive a text.
 */
const MOBILE_LEADING_DIGITS = ['6', '8', '9'];

/** Separators a person types and a provider will not accept. */
const SEPARATORS = /[\s\-.()]/g;

/**
 * `+66812345678`, or null when this is not a Thai mobile.
 *
 * Accepts the forms a Thai form actually collects: `0812345678`,
 * `+66812345678`, `66812345678`, `0066812345678`, and `+660812345678` — the
 * stray trunk zero somebody leaves when they put `+66` in front of the number
 * they know by heart.
 */
export function toThaiMobileE164(raw: string): string | null {
  const cleaned = raw.replace(SEPARATORS, '');
  if (!/^\+?\d+$/.test(cleaned)) return null;

  const national = nationalPart(cleaned.replace(/^\+/, ''));
  if (national === null || national.length !== NATIONAL_DIGITS) return null;
  if (!MOBILE_LEADING_DIGITS.includes(national[0])) return null;

  return `+${COUNTRY_CODE}${national}`;
}

/**
 * The subscriber digits, with the international prefix and the trunk zero
 * stripped — null when the number belongs to another country.
 */
function nationalPart(digits: string): string | null {
  const withoutIdd = digits.startsWith('00') ? digits.slice(2) : digits;

  if (withoutIdd.startsWith(COUNTRY_CODE)) {
    // `+660812345678` — the writer kept the trunk zero after the country code.
    return withoutIdd.slice(COUNTRY_CODE.length).replace(/^0/, '');
  }
  if (withoutIdd.startsWith('0')) return withoutIdd.slice(1);

  // Neither a Thai country code nor a national trunk zero: not ours to send.
  return null;
}
