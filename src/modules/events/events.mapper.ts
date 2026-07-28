import { EventResponseDto } from './dto/event-response.dto';
import type { EventRow } from './events.types';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** Map a Drizzle `events` row to its response DTO (edge boundary). */
export function toEventResponse(e: EventRow): EventResponseDto {
  return {
    id: e.id,
    slug: e.slug,
    name: e.name,
    description: e.description,
    type: e.type,
    status: e.status,
    bucket: e.bucket,
    visibility: e.visibility,
    startAt: e.startAt.toISOString(),
    endAt: iso(e.endAt),
    timezone: e.timezone,
    isOnline: e.isOnline,
    seatingMode: e.seatingMode,
    organizerName: e.organizerName,
    publishedAt: iso(e.publishedAt),
    createdAt: e.createdAt.toISOString(),
  };
}
