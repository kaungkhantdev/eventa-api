import { CategoryResponseDto } from './dto/category-response.dto';
import type { CategoryRow } from './event-categories.types';

/** Map a `categories` row + its live event count to the response DTO (edge). */
export function toCategoryResponse(
  c: CategoryRow,
  eventCount: number,
): CategoryResponseDto {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    icon: c.icon,
    color: c.color,
    eventCount,
    createdAt: c.createdAt.toISOString(),
    version: c.version,
  };
}
