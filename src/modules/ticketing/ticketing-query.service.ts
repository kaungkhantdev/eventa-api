import { Injectable } from '@nestjs/common';
import { Paginated } from '../../common/http/paginated';
import type { EventActor } from '../events/events.types';
import { TicketInventoryDto } from './dto/ticket-inventory.dto';
import { EventLookupPort } from './ports/event-lookup.port';
import { TicketingRepository } from './ticketing.repository';
import type {
  ListTicketsQuery,
  TicketRow,
  TicketStatusCounts,
} from './ticketing.types';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * The read side of Ticketing: one searchable, filterable view of every tier the
 * organizer sells, across all their events (US-TKT-04). Read-only by
 * construction — `sold` and `total` are shown, never written from here.
 */
@Injectable()
export class TicketingQueryService {
  constructor(
    private readonly repo: TicketingRepository,
    private readonly events: EventLookupPort,
  ) {}

  async list(
    actor: EventActor,
    query: ListTicketsQuery,
  ): Promise<Paginated<TicketInventoryDto>> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, query.limit ?? DEFAULT_LIMIT),
    );
    const search = query.search?.trim();

    const { items, total } = await this.repo.search(actor.organizationId, {
      limit,
      offset: (page - 1) * limit,
      status: query.status,
      eventId: query.eventId,
      search,
      // "jazz" should find tiers on the Jazz Festival too, not just tiers named
      // "Jazz pass" — so Events resolves which of its own rows match.
      eventIds: search
        ? await this.events.idsMatchingName(actor.organizationId, search)
        : undefined,
    });

    return Paginated.of(
      await this.decorate(actor.organizationId, items),
      total,
      page,
      limit,
    );
  }

  /** The tab badges — one live count per availability state. */
  statusCounts(actor: EventActor): Promise<TicketStatusCounts> {
    return this.repo.countsByStatus(actor.organizationId);
  }

  private async decorate(
    organizationId: number,
    rows: TicketRow[],
  ): Promise<TicketInventoryDto[]> {
    if (rows.length === 0) return [];
    const [briefs, vatRate] = await Promise.all([
      this.events.briefsByIds(
        organizationId,
        rows.map((r) => r.eventId),
      ),
      this.repo.orgVatRate(organizationId),
    ]);
    return rows.map((r) =>
      toInventoryItem(r, briefs.get(r.eventId)?.name, vatRate),
    );
  }
}

function toInventoryItem(
  t: TicketRow,
  eventName: string | undefined,
  vatRate: number,
): TicketInventoryDto {
  return {
    id: t.id,
    eventId: t.eventId,
    // A tier outliving its event is a data problem, not a reason to hide the row.
    eventName: eventName ?? '',
    name: t.name,
    isFree: t.isFree,
    priceSatang: t.priceSatang,
    vatRate,
    status: t.status,
    sold: t.sold,
    total: t.total,
    salesStartAt: t.salesStartAt?.toISOString() ?? null,
    salesEndAt: t.salesEndAt?.toISOString() ?? null,
  };
}
