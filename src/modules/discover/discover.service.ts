import { Injectable } from '@nestjs/common';
import { Paginated } from '../../common/http/paginated';
import { Clock } from '../../common/time/clock';
import { DiscoverPolicy } from './discover.policy';
import { DiscoverRepository } from './discover.repository';
import type {
  DiscoverEventRow,
  DiscoverQuery,
  TierInventory,
} from './discover.types';
import type { EventCardDto } from './dto/event-card.dto';
import { EventAttendancePort } from './ports/event-attendance.port';

/** A card grid, not a table — a dozen fills a first screen without a scroll. */
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 48;
const FIRST_PAGE = 1;

/**
 * The anonymous Discover grid (US-DISC-01) with its keyword and category filters
 * (US-DISC-02). Every event here is published, publicly visible and still ahead —
 * the repository decides that, as of the instant this service hands it.
 *
 * The card is assembled from three sources: the event's own content, its ticket
 * inventory (badge and price-from, via `DiscoverPolicy`), and how many people are
 * going — the last through a port, because registration data belongs to another
 * context even when the number it yields is public.
 */
@Injectable()
export class DiscoverService {
  constructor(
    private readonly repo: DiscoverRepository,
    private readonly policy: DiscoverPolicy,
    private readonly attendance: EventAttendancePort,
    private readonly clock: Clock,
  ) {}

  async browse(query: DiscoverQuery): Promise<Paginated<EventCardDto>> {
    const now = this.clock.now();
    const page = Math.max(FIRST_PAGE, query.page ?? FIRST_PAGE);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, query.limit ?? DEFAULT_LIMIT),
    );
    const { items, total } = await this.repo.search(
      {
        search: trimmed(query.q),
        category: trimmed(query.category),
        limit,
        offset: (page - FIRST_PAGE) * limit,
      },
      now,
    );
    return Paginated.of(await this.decorate(items), total, page, limit);
  }

  /** The category chips, drawn from what published events actually use. */
  categories(): Promise<string[]> {
    return this.repo.categoryNames(this.clock.now());
  }

  /**
   * The same decorated card, addressed by id — how an attendee's saved list
   * (US-DISC-03) renders, and the single place that answers "may this person see
   * this event at all?". Ids that no longer resolve are dropped rather than
   * faulted, and the answer keeps the order asked.
   *
   * Unlike the grid this does NOT filter out events already under way: an
   * attendee who saved something should still see it on the day.
   */
  async cardsByIds(eventIds: string[]): Promise<EventCardDto[]> {
    if (eventIds.length === 0) return [];
    const rows = await this.repo.findByIds(eventIds);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const found = eventIds
      .map((id) => byId.get(id))
      .filter((row): row is DiscoverEventRow => row !== undefined);
    return this.decorate(found);
  }

  private async decorate(rows: DiscoverEventRow[]): Promise<EventCardDto[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [tiers, going] = await Promise.all([
      this.repo.tiersByEvent(ids),
      this.attendance.goingCounts(ids),
    ]);
    return rows.map((row) =>
      this.toCard(row, tiers.get(row.id) ?? [], going.get(row.id) ?? 0),
    );
  }

  private toCard(
    row: DiscoverEventRow,
    tiers: TierInventory[],
    goingCount: number,
  ): EventCardDto {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      type: row.type,
      categoryName: row.categoryName,
      startAt: row.startAt.toISOString(),
      endAt: row.endAt?.toISOString() ?? null,
      timezone: row.timezone,
      isOnline: row.isOnline,
      // An online event has no venue to show, whatever the row happens to hold.
      venueName: row.isOnline ? null : row.venueName,
      city: row.isOnline ? null : row.city,
      coverImage: row.coverImage,
      organizerName: row.organizerName,
      goingCount,
      priceFrom: this.policy.label(this.policy.priceFrom(tiers)),
      badge: this.policy.resolveBadge(tiers),
      // Real attendee feedback lands with US-DISC-13; never a placeholder.
      rating: null,
    };
  }
}

/** A stray-space-only filter is no filter — the visitor meant "everything". */
function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}
