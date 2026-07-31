import { slugify as baseSlugify } from '../../common/util/slugify';

/** Slugify an event name (entities.md: `^[a-z0-9-]+$`, 3–80; Thai-only → `event`). */
export function slugify(name: string): string {
  return baseSlugify(name, 'event');
}
