import {
  generateOrderReference,
  generateQrToken,
  withFreshReference,
} from './order-reference';

/** Characters a person reliably mis-copies off a screen or hears wrong. */
const AMBIGUOUS = /[ILOU]/;

describe('generateOrderReference', () => {
  it('reads back as ORD- plus eight characters', () => {
    expect(generateOrderReference()).toMatch(/^ORD-[0-9A-HJKMNP-TV-Z]{8}$/);
  });

  it('avoids characters that get mis-heard down a phone line', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(AMBIGUOUS.test(generateOrderReference().slice(4))).toBe(false);
    }
  });

  it('does not repeat itself in any practical run', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2_000; i += 1) seen.add(generateOrderReference());
    expect(seen.size).toBe(2_000);
  });

  it('is not sequential — it leaks nothing about order volume', () => {
    const a = generateOrderReference();
    const b = generateOrderReference();
    expect(a).not.toBe(b);
  });
});

describe('generateQrToken', () => {
  it('is 24 unambiguous characters of entropy', () => {
    expect(generateQrToken()).toMatch(/^[0-9A-HJKMNP-TV-Z]{24}$/);
  });

  it('does not repeat itself in any practical run', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2_000; i += 1) seen.add(generateQrToken());
    expect(seen.size).toBe(2_000);
  });
});

/**
 * THE FIXTURES HERE WERE THE BUG.
 *
 * They built `{ code, constraint_name }` on a bare Error — which is the shape
 * `isReferenceCollision` read, and a shape Postgres never produces. So these
 * tests passed against a guard that was ALWAYS false in production, and the
 * retry they describe never once happened: a reference collision was rethrown
 * on the first attempt and the buyer got a 500 for something the design
 * retries silently. (It also fed the 5xx log, which is how the buyer's name,
 * email and phone reached it.)
 *
 * Two things are wrong with that shape, the same two that made
 * `isUniqueViolation` always false before it was fixed:
 *
 * - `pg-protocol` builds the error with `message.constraint = fields.n`.
 *   There is no `constraint_name` on it anywhere.
 * - Drizzle wraps every query rejection, so the pg error sits at `.cause` and
 *   the object actually caught carries no `code` at all.
 *
 * The fixtures below are now shaped as drizzle really hands them over, which
 * is the only reason these tests mean anything.
 */
describe('withFreshReference', () => {
  /** As drizzle hands it over: its own wrapper, pg's error at `.cause`. */
  const pgCollision = (constraint: string) =>
    Object.assign(new Error('Failed query: insert into "orders" …'), {
      cause: Object.assign(new Error('duplicate key value'), {
        code: '23505',
        constraint,
      }),
    });

  const collision = pgCollision('uq_orders_org_reference');

  it('tries another reference when the first one is taken', async () => {
    const tried: string[] = [];
    const placed = await withFreshReference((reference) => {
      tried.push(reference);
      return tried.length === 1
        ? Promise.reject(collision)
        : Promise.resolve(reference);
    });
    expect(tried).toHaveLength(2);
    expect(tried[0]).not.toBe(tried[1]);
    expect(placed).toBe(tried[1]);
  });

  it('does not retry any other failure', async () => {
    // A retried idempotency-key clash would place a second order; only the
    // reference is safe to change blind.
    const other = pgCollision('uq_orders_org_idem');
    const place = jest.fn().mockRejectedValue(other);
    await expect(withFreshReference(place)).rejects.toBe(other);
    expect(place).toHaveBeenCalledTimes(1);
  });

  it('gives up after three collisions', async () => {
    const place = jest.fn().mockRejectedValue(collision);
    await expect(withFreshReference(place)).rejects.toBe(collision);
    expect(place).toHaveBeenCalledTimes(3);
  });
});
