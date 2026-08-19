import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { BANGKOK_OFFSET_MS, bangkokDay } from '../../common/time/bangkok';
import { Clock } from '../../common/time/clock';
import { Paginated } from '../../common/http/paginated';
import { CalendarResponseDto } from './dto/calendar-response.dto';
import { EventListItemDto } from './dto/event-list-item.dto';
import { EventsSummaryDto } from './dto/events-summary.dto';
import { UpcomingEventDto } from './dto/upcoming-event.dto';
import { toEventListItem, toEventResponse } from './events.mapper';
import { EventsRepository } from './events.repository';
import { TicketAvailabilityPort } from './ports/ticket-availability.port';
import type {
  EventActor,
  EventRow,
  EventSales,
  ListEventsFilters,
  ListEventsQuery,
} from './events.types';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DEFAULT_UPCOMING_LIMIT = 20;
const MAX_UPCOMING_LIMIT = 100;

/**
 * The Events read side: the organizer's list, the tab badge counts, the calendar
 * and the "what's coming up" board. Kept apart from EventsService (which owns the
 * writes and the publish/cancel lifecycle) because these are query concerns —
 * paging, sorting and folding in Ticketing's sold counts — with no state changes.
 */
@Injectable()
export class EventsQueryService {
  constructor(
    private readonly repo: EventsRepository,
    @Inject(forwardRef(() => TicketAvailabilityPort))
    private readonly tickets: TicketAvailabilityPort,
    private readonly clock: Clock,
  ) {}

  /** The organizer's events for this tenant, filtered/sorted, one page at a time. */
  async list(
    actor: EventActor,
    query: ListEventsQuery,
  ): Promise<Paginated<EventListItemDto>> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, query.limit ?? DEFAULT_LIMIT),
    );
    const sort = query.sort ?? 'recent';
    const filters = listFilters(query);
    if (sort === 'registrations') {
      return this.listByRegistrations(
        actor.organizationId,
        filters,
        page,
        limit,
      );
    }
    const { items, total } = await this.repo.list(actor.organizationId, {
      limit,
      offset: (page - 1) * limit,
      sort,
      ...filters,
    });
    const rows = await this.withFill(actor.organizationId, items);
    return Paginated.of(rows, total, page, limit);
  }

  /** Active/Completed live-event counts (the tab badges). */
  async summary(actor: EventActor): Promise<EventsSummaryDto> {
    return this.repo.bucketCounts(actor.organizationId);
  }

  /** The month's events for the calendar (Bangkok-time month; count in the header). */
  async calendar(
    actor: EventActor,
    month?: string,
  ): Promise<CalendarResponseDto> {
    const target = month ?? this.currentBangkokMonth();
    const { start, end } = monthRangeUtc(target);
    const rows = await this.repo.listInRange(actor.organizationId, start, end);
    return {
      month: target,
      count: rows.length,
      events: rows.map(toEventResponse),
    };
  }

  /** Future events soonest-first, each with days-left (Bangkok) and a fill %. */
  async upcoming(
    actor: EventActor,
    limit?: number,
  ): Promise<UpcomingEventDto[]> {
    const capped = Math.min(
      MAX_UPCOMING_LIMIT,
      Math.max(1, limit ?? DEFAULT_UPCOMING_LIMIT),
    );
    const now = this.clock.now();
    const rows = await this.repo.listUpcoming(
      actor.organizationId,
      now,
      capped,
    );
    const sales = await this.tickets.salesByEvent(
      actor.organizationId,
      rows.map((r) => r.id),
    );
    const nowDay = bangkokDay(now);
    return rows.map((e) => this.toUpcoming(e, sales.get(e.id), nowDay));
  }

  /**
   * Sort by registrations — a Ticketing-derived metric, so it can't be an SQL
   * ORDER BY on the events table. Load the org's matching events (a small, bounded
   * set), fold in each one's sold count, sort fullest-first, then page in memory.
   */
  private async listByRegistrations(
    organizationId: number,
    filters: ListEventsFilters,
    page: number,
    limit: number,
  ): Promise<Paginated<EventListItemDto>> {
    const rows = await this.repo.listAll(organizationId, filters);
    const sales = await this.tickets.salesByEvent(
      organizationId,
      rows.map((r) => r.id),
    );
    const ordered = [...rows].sort((a, b) => byRegistrations(a, b, sales));
    const start = (page - 1) * limit;
    const items = ordered
      .slice(start, start + limit)
      .map((r) => toEventListItem(r, sales.get(r.id)));
    return Paginated.of(items, ordered.length, page, limit);
  }

  /** Fold each row's registrations-vs-capacity fill (one batched ticket query). */
  private async withFill(
    organizationId: number,
    rows: EventRow[],
  ): Promise<EventListItemDto[]> {
    const sales = await this.tickets.salesByEvent(
      organizationId,
      rows.map((r) => r.id),
    );
    return rows.map((r) => toEventListItem(r, sales.get(r.id)));
  }

  private toUpcoming(
    e: EventRow,
    sale: { sold: number; quantity: number } | undefined,
    nowDay: number,
  ): UpcomingEventDto {
    const sold = sale?.sold ?? 0;
    const capacity = e.capacity ?? sale?.quantity ?? 0;
    return {
      id: e.id,
      name: e.name,
      slug: e.slug,
      type: e.type,
      status: e.status,
      startAt: e.startAt.toISOString(),
      daysLeft: Math.max(0, bangkokDay(e.startAt) - nowDay),
      sold,
      capacity,
      fillPercent: capacity > 0 ? Math.round((sold / capacity) * 100) : 0,
    };
  }

  private currentBangkokMonth(): string {
    const bangkok = new Date(this.clock.now().getTime() + BANGKOK_OFFSET_MS);
    const month = String(bangkok.getUTCMonth() + 1).padStart(2, '0');
    return `${bangkok.getUTCFullYear()}-${month}`;
  }
}

/** The defined-only search/type/bucket filters carried by a list query. */
function listFilters(query: ListEventsQuery): ListEventsFilters {
  return {
    ...(query.q ? { q: query.q } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.bucket ? { bucket: query.bucket } : {}),
  };
}

/** Order events fullest-first, tie-breaking by most-recent then id (stable paging). */
function byRegistrations(
  a: EventRow,
  b: EventRow,
  sales: Map<string, EventSales>,
): number {
  const soldA = sales.get(a.id)?.sold ?? 0;
  const soldB = sales.get(b.id)?.sold ?? 0;
  if (soldA !== soldB) return soldB - soldA;
  const createdDelta = b.createdAt.getTime() - a.createdAt.getTime();
  if (createdDelta !== 0) return createdDelta;
  return a.id.localeCompare(b.id);
}

/** UTC bounds `[start, end)` of a `YYYY-MM` month interpreted in Asia/Bangkok. */
function monthRangeUtc(month: string): { start: Date; end: Date } {
  const [year, monthNumber] = month.split('-').map(Number);
  return {
    start: new Date(Date.UTC(year, monthNumber - 1, 1) - BANGKOK_OFFSET_MS),
    end: new Date(Date.UTC(year, monthNumber, 1) - BANGKOK_OFFSET_MS),
  };
}
