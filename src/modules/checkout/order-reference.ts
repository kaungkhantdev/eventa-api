import { randomInt } from 'node:crypto';
import { isUniqueViolation } from '../../common/errors/unique-violation';
import {
  ALPHABET,
  LENGTH,
  PREFIX,
  QR_TOKEN_LENGTH,
  REFERENCE_ATTEMPTS,
  REFERENCE_CONSTRAINT,
} from '../../common/constants/checkout.constants';

/**
 * A booking reference an attendee can read down a phone line: `ORD-7K2M9QX4`.
 *
 * Random rather than sequential on purpose — a sequence would leak how many
 * orders a workspace has taken, and let anyone guess the reference next to
 * theirs. 32^8 ≈ 1.1e12 keeps collisions rare; `uq_orders_org_reference` catches
 * the rest, and the caller retries.
 */
export function generateOrderReference(): string {
  let body = '';
  for (let i = 0; i < LENGTH; i += 1) {
    body += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `${PREFIX}-${body}`;
}

/**
 * The bearer token printed into a ticket's QR. High-entropy and opaque: check-in
 * looks it up rather than verifying a signature, so there is no key to rotate and
 * a revoked ticket is revoked the instant its row changes.
 */
export function generateQrToken(): string {
  let token = '';
  for (let i = 0; i < QR_TOKEN_LENGTH; i += 1) {
    token += ALPHABET[randomInt(ALPHABET.length)];
  }
  return token;
}

/**
 * Insert something that carries a new reference, retrying ONLY when the
 * reference itself collided.
 *
 * References are random, so a collision is astronomically unlikely but not
 * impossible; `uq_orders_org_reference` catches it and another is tried. Any
 * other failure is rethrown untouched — in particular a clash on the
 * idempotency key, which means this request already placed something and must
 * not place a second.
 */
export async function withFreshReference<T>(
  place: (reference: string) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await place(generateOrderReference());
    } catch (error) {
      if (!isReferenceCollision(error) || attempt >= REFERENCE_ATTEMPTS) {
        throw error;
      }
    }
  }
}

/**
 * Through the shared guard, not by reading the caught object directly.
 *
 * This asked for `error.constraint_name` and `error.code` on the thing it
 * caught, and both are wrong in the same two ways `isUniqueViolation` was
 * before it was fixed: `pg-protocol` names the field `constraint`, and
 * Drizzle wraps every rejection so the pg error sits at `.cause`. Both wrong
 * at once made this ALWAYS false — the three attempts above never happened,
 * and a reference collision became a 500 for something the design retries
 * silently.
 */
function isReferenceCollision(error: unknown): boolean {
  return isUniqueViolation(error, REFERENCE_CONSTRAINT);
}
