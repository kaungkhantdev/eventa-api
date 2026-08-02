import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  like,
  lt,
  ne,
  sql,
  type SQL,
} from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { categories, events, organizations } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import type {
  EventBucketCounts,
  EventRow,
  EventSort,
  ListEventsFilters,
  ListEventsOptions,
  NewEventValues,
} from './events.types';

/** Data access for the Events context. All reads/writes are tenant-scoped (RLS). */
@Injectable()
export class EventsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Which workspace owns this event — backs `EventOrgLookupPort`. Deliberately
   * NOT tenant-scoped: it is what establishes the tenant for an anonymous
   * checkout, and it can only ever return the event's own organization.
   */
  async organizationIdFor(eventId: string): Promise<number | null> {
    const [row] = await this.db
      .select({ organizationId: events.organizationId })
      .from(events)
      .where(and(eq(events.id, eventId), isNull(events.deletedAt)))
      .limit(1);
    return row?.organizationId ?? null;
  }

  /** Names for the given events (tenant-scoped) — backs `EventLookupPort`. */
  async briefsByIds(
    organizationId: number,
    eventIds: string[],
  ): Promise<{ id: string; name: string }[]> {
    const ids = [...new Set(eventIds)];
    if (ids.length === 0) return [];
    return withTenant(this.db, organizationId, (tx) =>
      tx
        .select({ id: events.id, name: events.name })
        .from(events)
        .where(
          and(
            eq(events.organizationId, organizationId),
            inArray(events.id, ids),
            isNull(events.deletedAt),
          ),
        ),
    );
  }

  /** Ids of live events whose name matches `search` — backs `EventLookupPort`. */
  async idsMatchingName(
    organizationId: number,
    search: string,
  ): Promise<string[]> {
    return withTenant(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select({ id: events.id })
        .from(events)
        .where(
          and(
            eq(events.organizationId, organizationId),
            ilike(events.name, `%${search}%`),
            isNull(events.deletedAt),
          ),
        );
      return rows.map((r) => r.id);
    });
  }

  /** Slugs in this org that begin with `base` — used to pick a free, unique slug. */
  async existingSlugs(organizationId: number, base: string): Promise<string[]> {
    return withTenant(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select({ slug: events.slug })
        .from(events)
        .where(
          and(
            eq(events.organizationId, organizationId),
            like(events.slug, `${base}%`),
          ),
        );
      return rows.map((r) => r.slug);
    });
  }

  /** The organization's display name (default `organizer_name` for a new event). */
  async organizationName(organizationId: number): Promise<string> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);
      return row?.name ?? '';
    });
  }

  /**
   * Does this category exist in the caller's org? Filters by organization_id
   * explicitly (in addition to RLS) so a foreign-tenant category id is never
   * reachable — Postgres FK checks bypass RLS, so the app must guard this.
   */
  async categoryExists(
    organizationId: number,
    categoryId: number,
  ): Promise<boolean> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(
          and(
            eq(categories.id, categoryId),
            eq(categories.organizationId, organizationId),
            isNull(categories.deletedAt),
          ),
        )
        .limit(1);
      return row !== undefined;
    });
  }

  async insert(values: NewEventValues): Promise<EventRow> {
    return withTenant(this.db, values.organizationId, async (tx) => {
      const [row] = await tx.insert(events).values(values).returning();
      return row;
    });
  }

  /** A single live event scoped to the org (null if absent/soft-deleted). */
  async findEvent(
    organizationId: number,
    eventId: string,
  ): Promise<EventRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select()
        .from(events)
        .where(
          and(
            eq(events.id, eventId),
            eq(events.organizationId, organizationId),
            isNull(events.deletedAt),
          ),
        )
        .limit(1);
      return row ?? null;
    });
  }

  /**
   * Optimistic update: only writes when `version` still matches, bumping it.
   * Returns null when no row matched (concurrent change) — the caller 409s.
   */
  async update(
    organizationId: number,
    eventId: string,
    values: Partial<NewEventValues>,
    currentVersion: number,
  ): Promise<EventRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .update(events)
        .set({ ...values, version: currentVersion + 1, updatedAt: new Date() })
        .where(
          and(
            eq(events.id, eventId),
            eq(events.organizationId, organizationId),
            eq(events.version, currentVersion),
            isNull(events.deletedAt),
          ),
        )
        .returning();
      return row ?? null;
    });
  }

  /** Live events whose start falls in `[startUtc, endUtc)`, earliest first (calendar). */
  async listInRange(
    organizationId: number,
    startUtc: Date,
    endUtc: Date,
  ): Promise<EventRow[]> {
    return withTenant(this.db, organizationId, async (tx) => {
      return tx
        .select()
        .from(events)
        .where(
          and(
            eq(events.organizationId, organizationId),
            isNull(events.deletedAt),
            gte(events.startAt, startUtc),
            lt(events.startAt, endUtc),
          ),
        )
        .orderBy(asc(events.startAt), asc(events.id));
    });
  }

  /** Live, non-cancelled events starting at/after `nowUtc`, soonest first (upcoming). */
  async listUpcoming(
    organizationId: number,
    nowUtc: Date,
    limit: number,
  ): Promise<EventRow[]> {
    return withTenant(this.db, organizationId, async (tx) => {
      return tx
        .select()
        .from(events)
        .where(
          and(
            eq(events.organizationId, organizationId),
            isNull(events.deletedAt),
            gte(events.startAt, nowUtc),
            ne(events.status, 'cancelled'),
          ),
        )
        .orderBy(asc(events.startAt), asc(events.id))
        .limit(limit);
    });
  }

  /** Permanently remove an event (cascades to its tickets/sessions/seats/…). */
  async hardDelete(organizationId: number, eventId: string): Promise<void> {
    await withTenant(this.db, organizationId, async (tx) => {
      await tx
        .delete(events)
        .where(
          and(
            eq(events.id, eventId),
            eq(events.organizationId, organizationId),
          ),
        );
    });
  }

  /** A filtered, sorted page of this org's live events, plus the total count. */
  async list(
    organizationId: number,
    opts: ListEventsOptions,
  ): Promise<{ items: EventRow[]; total: number }> {
    const where = this.matchWhere(organizationId, opts);
    return withTenant(this.db, organizationId, async (tx) => {
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(events)
        .where(where);
      const items = await tx
        .select()
        .from(events)
        .where(where)
        .orderBy(...orderColumns(opts.sort))
        .limit(opts.limit)
        .offset(opts.offset);
      return { items, total: count };
    });
  }

  /**
   * Every matching live event (no pagination), newest first. Used to sort by a
   * cross-context metric (registrations) in-app — the set is one org's own events,
   * so it is small and bounded, unlike orders/tickets.
   */
  async listAll(
    organizationId: number,
    filters: ListEventsFilters,
  ): Promise<EventRow[]> {
    const where = this.matchWhere(organizationId, filters);
    return withTenant(this.db, organizationId, async (tx) =>
      tx
        .select()
        .from(events)
        .where(where)
        .orderBy(desc(events.createdAt), asc(events.id)),
    );
  }

  /** Live-event counts split by bucket (Active/Completed tab badges). */
  async bucketCounts(organizationId: number): Promise<EventBucketCounts> {
    return withTenant(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select({ bucket: events.bucket, count: sql<number>`count(*)::int` })
        .from(events)
        .where(
          and(
            eq(events.organizationId, organizationId),
            isNull(events.deletedAt),
          ),
        )
        .groupBy(events.bucket);
      const counts: EventBucketCounts = { active: 0, completed: 0 };
      for (const r of rows) counts[r.bucket] = r.count;
      return counts;
    });
  }

  private matchWhere(organizationId: number, filters: ListEventsFilters): SQL {
    const clauses: (SQL | undefined)[] = [
      eq(events.organizationId, organizationId),
      isNull(events.deletedAt),
      filters.bucket ? eq(events.bucket, filters.bucket) : undefined,
      filters.type ? eq(events.type, filters.type) : undefined,
      filters.q ? ilike(events.name, `%${likeEscape(filters.q)}%`) : undefined,
    ];
    return and(...clauses) as SQL;
  }
}

/** Escape LIKE/ILIKE metacharacters so `%`/`_` in a search term match literally. */
function likeEscape(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Sort columns, always with a unique `id` tiebreaker so paging can't skip/dup. */
function orderColumns(sort: EventSort): SQL[] {
  const tiebreaker = asc(events.id);
  if (sort === 'name') return [asc(events.name), tiebreaker];
  if (sort === 'date') return [asc(events.startAt), tiebreaker];
  return [desc(events.createdAt), tiebreaker];
}
