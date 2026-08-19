import { Injectable } from '@nestjs/common';
import { Paginated } from '../../common/http/paginated';
import { Clock } from '../../common/time/clock';
import { DiscountListItemDto } from './dto/discount-list-item.dto';
import { toSnapshot } from './discounts.mapper';
import { DiscountsPolicy } from './discounts.policy';
import { DiscountsRepository } from './discounts.repository';
import { EventLookupPort } from '../ticketing/ports/event-lookup.port';
import type {
  DiscountActor,
  DiscountRow,
  DiscountStatus,
  ListDiscountsQuery,
} from './discounts.types';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const ALL_EVENTS_LABEL = 'All events';

/**
 * Browsing promotions (US-TKT-12): type, scope, live redemption counts and
 * status, filterable and searchable. Read-only — counts are never edited here.
 *
 * It also settles US-TKT-10's "codes expire on schedule" without a cron: each
 * listed code's status is re-derived from its window and usage, and any drift is
 * written back. Reading the list is what keeps it honest.
 */
@Injectable()
export class DiscountsQueryService {
  constructor(
    private readonly repo: DiscountsRepository,
    private readonly policy: DiscountsPolicy,
    private readonly events: EventLookupPort,
    private readonly clock: Clock,
  ) {}

  async list(
    actor: DiscountActor,
    query: ListDiscountsQuery,
  ): Promise<Paginated<DiscountListItemDto>> {
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
      eventIds: search
        ? await this.events.idsMatchingName(actor.organizationId, search)
        : undefined,
    });

    const settled = await this.settleStatuses(actor.organizationId, items);
    return Paginated.of(
      await this.decorate(actor.organizationId, settled),
      total,
      page,
      limit,
    );
  }

  /**
   * Re-derive each code's status and persist any drift, so a scheduled code goes
   * live and a finished one reads Expired without anyone touching it.
   */
  private async settleStatuses(
    organizationId: number,
    rows: DiscountRow[],
  ): Promise<DiscountRow[]> {
    const now = this.clock.now();
    const changes: { id: string; status: DiscountStatus }[] = [];
    const settled = rows.map((row) => {
      const status = this.policy.resolveStatus(toSnapshot(row), now);
      if (status !== row.status) changes.push({ id: row.id, status });
      return status === row.status ? row : { ...row, status };
    });
    await this.repo.syncStatuses(organizationId, changes);
    return settled;
  }

  private async decorate(
    organizationId: number,
    rows: DiscountRow[],
  ): Promise<DiscountListItemDto[]> {
    if (rows.length === 0) return [];
    const eventIds = rows
      .map((r) => r.eventId)
      .filter((id): id is string => id !== null);
    const briefs = await this.events.briefsByIds(organizationId, eventIds);
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      type: row.type,
      value: row.value,
      status: row.status,
      eventId: row.eventId,
      // A workspace-wide code shows where it applies, not a blank column.
      scopeLabel:
        row.eventId === null
          ? ALL_EVENTS_LABEL
          : (briefs.get(row.eventId)?.name ?? ''),
      used: row.used,
      redemptionLimit: row.redemptionLimit,
      minOrderSatang: row.minOrderSatang,
      validFrom: row.validFrom?.toISOString() ?? null,
      validUntil: row.validUntil?.toISOString() ?? null,
    }));
  }
}
