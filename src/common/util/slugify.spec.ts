import { slugify } from './slugify';

describe('slugify', () => {
  it('lowercases and hyphenates words', () => {
    expect(slugify('Tech Conference 2026')).toBe('tech-conference-2026');
  });

  it('collapses punctuation runs into single hyphens', () => {
    expect(slugify('Hello --- World!!!')).toBe('hello-world');
  });

  it('caps length at 80 and never leaves a trailing hyphen', () => {
    const slug = slugify('a'.repeat(79) + ' bcd');
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('falls back to the caller’s word when a name has no latin alphanumerics', () => {
    expect(slugify('อีเวนต์', 'event')).toBe('event');
  });

  it('falls back to "item" when no fallback is given', () => {
    expect(slugify('อีเวนต์')).toBe('item');
  });
});
