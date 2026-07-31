import { EventListItemDto } from './dto/event-list-item.dto';
import { EventResponseDto } from './dto/event-response.dto';
import type { EventRow, EventSales } from './events.types';

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
    categoryId: e.categoryId,
    startAt: e.startAt.toISOString(),
    endAt: iso(e.endAt),
    timezone: e.timezone,
    venueName: e.venueName,
    venueAddress: e.venueAddress,
    city: e.city,
    isOnline: e.isOnline,
    onlineNote: e.onlineNote,
    seatingMode: e.seatingMode,
    capacity: e.capacity,
    coverImage: e.coverImage,
    accentColor: e.accentColor,
    contactEmail: e.contactEmail,
    organizerName: e.organizerName,
    landingTemplateId: e.landingTemplateId,
    publishedAt: iso(e.publishedAt),
    createdAt: e.createdAt.toISOString(),
    version: e.version,
  };
}

/**
 * Map an event row to its list item, folding in the registrations-vs-capacity fill.
 * Effective capacity is the event's own capacity, falling back to the summed ticket
 * allocation; fill is 0 when neither yields a positive cap.
 */
export function toEventListItem(
  e: EventRow,
  sale: EventSales | undefined,
): EventListItemDto {
  const registrations = sale?.sold ?? 0;
  const capacity = e.capacity ?? sale?.quantity ?? 0;
  const fillPercent =
    capacity > 0 ? Math.round((registrations / capacity) * 100) : 0;
  return { ...toEventResponse(e), registrations, fillPercent };
}
