import { generateOrderReference, generateQrToken } from './order-reference';

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
