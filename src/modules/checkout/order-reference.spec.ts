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

describe('withFreshReference', () => {
  const collision = Object.assign(new Error('duplicate'), {
    code: '23505',
    constraint_name: 'uq_orders_org_reference',
  });

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
    const other = Object.assign(new Error('other'), {
      code: '23505',
      constraint_name: 'uq_orders_org_idem',
    });
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
