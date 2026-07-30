import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  isNull,
  like,
  sql,
  type SQL,
} from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { categories, events, organizations } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import type {
  EventRow,
  EventSort,
  ListEventsOptions,
  NewEventValues,
} from './events.types';

/** Data access for the Events context. All reads/writes are tenant-scoped (RLS). */
@Injectable()
export class EventsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

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
    const where = this.listWhere(organizationId, opts);
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

  private listWhere(organizationId: number, opts: ListEventsOptions): SQL {
    const filters: (SQL | undefined)[] = [
      eq(events.organizationId, organizationId),
      isNull(events.deletedAt),
      opts.bucket ? eq(events.bucket, opts.bucket) : undefined,
      opts.type ? eq(events.type, opts.type) : undefined,
      opts.q ? ilike(events.name, `%${likeEscape(opts.q)}%`) : undefined,
    ];
    return and(...filters) as SQL;
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
