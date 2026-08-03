import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { categories, events, ticketTypes } from '../../db/schema';
import type {
  DiscoverEventRow,
  DiscoverSearch,
  TierInventory,
} from './discover.types';

/** Statuses whose event is live to the public — a draft or cancelled one is not. */
const LIVE_STATUSES = ['planned', 'upcoming', 'live'] as const;
/** Only a public event belongs in the grid; unlisted and private do not. */
const PUBLIC_VISIBILITY = 'public';

/** The one projection behind every card, so the grid and a saved list agree. */
const EVENT_CARD_COLUMNS = {
  id: events.id,
  slug: events.slug,
  name: events.name,
  description: events.description,
  type: events.type,
  categoryName: categories.name,
  startAt: events.startAt,
  endAt: events.endAt,
  timezone: events.timezone,
  isOnline: events.isOnline,
  venueName: events.venueName,
  city: events.city,
  coverImage: events.coverImage,
  organizerName: events.organizerName,
};

/**
 * Reads for the ANONYMOUS Discover grid (US-DISC-01/02). Deliberately not
 * tenant-scoped and deliberately cross-tenant: a visitor has no tenant, and the
 * whole point of the page is every workspace's public events side by side. The
 * filter below is the only boundary that matters, so it is applied to every query
 * here — published, publicly visible, not deleted, and still ahead of `now`.
 *
 * Event *content* is composed straight from the event's own tables (as
 * `PublicPagesRepository` does); anything about registrations arrives through
 * `EventAttendancePort`, never from a join to orders or attendees.
 */
@Injectable()
export class DiscoverRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** A page of browsable events, soonest first, plus the total that matched. */
  async search(
    query: DiscoverSearch,
    now: Date,
  ): Promise<{ items: DiscoverEventRow[]; total: number }> {
    const where = this.matchWhere(query, now);
    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(events)
      .leftJoin(categories, eq(categories.id, events.categoryId))
      .where(where);
    const items = await this.db
      .select(EVENT_CARD_COLUMNS)
      .from(events)
      .leftJoin(categories, eq(categories.id, events.categoryId))
      .where(where)
      // A unique tiebreaker so paging can never skip or repeat a card.
      .orderBy(asc(events.startAt), asc(events.id))
      .limit(query.limit)
      .offset(query.offset);
    return { items, total: count };
  }

  /**
   * The same event rows addressed by id, for an attendee's saved list
   * (US-DISC-03). Still published and publicly visible — an event the organizer
   * has taken down is gone from every surface — but deliberately WITHOUT the
   * "still ahead of now" filter, so a saved event survives to its own start time.
   */
  findByIds(eventIds: string[]): Promise<DiscoverEventRow[]> {
    const ids = [...new Set(eventIds)];
    if (ids.length === 0) return Promise.resolve([]);
    return this.db
      .select(EVENT_CARD_COLUMNS)
      .from(events)
      .leftJoin(categories, eq(categories.id, events.categoryId))
      .where(and(this.published(), inArray(events.id, ids)));
  }

  /** Live tiers for the given events, grouped by event (empty ids → empty map). */
  async tiersByEvent(
    eventIds: string[],
  ): Promise<Map<string, TierInventory[]>> {
    const ids = [...new Set(eventIds)];
    const byEvent = new Map<string, TierInventory[]>();
    if (ids.length === 0) return byEvent;
    const rows = await this.db
      .select({
        eventId: ticketTypes.eventId,
        priceSatang: ticketTypes.priceSatang,
        isFree: ticketTypes.isFree,
        status: ticketTypes.status,
        sold: ticketTypes.sold,
        total: ticketTypes.total,
      })
      .from(ticketTypes)
      .where(
        and(inArray(ticketTypes.eventId, ids), isNull(ticketTypes.deletedAt)),
      );
    for (const { eventId, ...tier } of rows) {
      const list = byEvent.get(eventId);
      if (list) list.push(tier);
      else byEvent.set(eventId, [tier]);
    }
    return byEvent;
  }

  /** The distinct categories browsable events use, for the filter chips. */
  async categoryNames(now: Date): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ name: categories.name })
      .from(events)
      .innerJoin(categories, eq(categories.id, events.categoryId))
      .where(and(this.browsable(now), isNull(categories.deletedAt)))
      .orderBy(asc(categories.name));
    return rows.map((r) => r.name);
  }

  private matchWhere(query: DiscoverSearch, now: Date): SQL {
    return and(
      this.browsable(now),
      query.search ? this.keywordMatch(query.search) : undefined,
      query.category ? this.categoryMatch(query.category) : undefined,
    ) as SQL;
  }

  /** Published and publicly visible — the floor for showing an event anywhere. */
  private published(): SQL {
    return and(
      eq(events.visibility, PUBLIC_VISIBILITY),
      isNull(events.deletedAt),
      isNotNull(events.publishedAt),
      inArray(events.status, [...LIVE_STATUSES]),
    ) as SQL;
  }

  /** Published, and still ahead — one under way is no longer worth discovering. */
  private browsable(now: Date): SQL {
    return and(this.published(), gt(events.startAt, now)) as SQL;
  }

  /** Title, category, city or venue — accent- and tone-mark-insensitive. */
  private keywordMatch(term: string): SQL {
    const pattern = `%${likeEscape(term)}%`;
    const matches = (column: SQLWrapper) =>
      sql`public.search_norm(${column}) LIKE public.search_norm(${pattern})`;
    return or(
      matches(events.name),
      matches(events.city),
      matches(events.venueName),
      matches(categories.name),
    ) as SQL;
  }

  /** An exact category, compared the same forgiving way the search is. */
  private categoryMatch(category: string): SQL {
    return sql`public.search_norm(${categories.name}) = public.search_norm(${category})`;
  }
}

/** Escape LIKE metacharacters so `%`/`_` typed by a visitor match literally. */
function likeEscape(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}
