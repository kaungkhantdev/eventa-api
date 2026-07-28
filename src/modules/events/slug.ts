const MIN_LENGTH = 3;
const MAX_LENGTH = 80;
const FALLBACK = 'event';

/**
 * Turn a display name into a URL slug: lowercase, `a–z0–9` separated by single
 * hyphens (entities.md: `^[a-z0-9-]+$`, 3–80). Names that carry no latin
 * alphanumerics (e.g. Thai-only titles) fall back to a stable base.
 */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_LENGTH)
    .replace(/-+$/, ''); // truncation may land on a hyphen
  return slug.length >= MIN_LENGTH ? slug : FALLBACK;
}
