import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  ne,
  sql,
  type SQL,
} from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { categories, events } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import type {
  CategoryRow,
  CategorySort,
  CategoryWithCount,
  ListCategoriesOptions,
  NewCategoryValues,
} from './event-categories.types';

/** Data access for categories (Events context). All queries are tenant-scoped. */
@Injectable()
export class EventCategoriesRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Is this name already taken in the org (case-insensitive, excluding one id)? */
  async nameExists(
    organizationId: number,
    name: string,
    excludeId?: number,
  ): Promise<boolean> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(
          and(
            eq(categories.organizationId, organizationId),
            isNull(categories.deletedAt),
            sql`lower(${categories.name}) = lower(${name})`,
            excludeId ? ne(categories.id, excludeId) : undefined,
          ),
        )
        .limit(1);
      return row !== undefined;
    });
  }

  async insert(values: NewCategoryValues): Promise<CategoryRow> {
    return withTenant(this.db, values.organizationId, async (tx) => {
      const [row] = await tx.insert(categories).values(values).returning();
      return row;
    });
  }

  /** A page of the org's categories, each with its live event count, plus total. */
  async list(
    organizationId: number,
    opts: ListCategoriesOptions,
  ): Promise<{ items: CategoryWithCount[]; total: number }> {
    const where = and(
      eq(categories.organizationId, organizationId),
      isNull(categories.deletedAt),
      opts.q ? ilike(categories.name, `%${likeEscape(opts.q)}%`) : undefined,
    ) as SQL;
    const { rows, total } = await withTenant(
      this.db,
      organizationId,
      async (tx) => {
        const [{ count }] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(categories)
          .where(where);
        const page = await tx
          .select()
          .from(categories)
          .where(where)
          .orderBy(...orderColumns(opts.sort))
          .limit(opts.limit)
          .offset(opts.offset);
        return { rows: page, total: count };
      },
    );
    const counts = await this.countsFor(
      organizationId,
      rows.map((r) => r.id),
    );
    const items = rows.map((r) => ({
      ...r,
      eventCount: counts.get(r.id) ?? 0,
    }));
    return { items, total };
  }

  /** A single live category scoped to the org (null if absent/soft-deleted). */
  async findCategory(
    organizationId: number,
    id: number,
  ): Promise<CategoryRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select()
        .from(categories)
        .where(this.byId(organizationId, id))
        .limit(1);
      return row ?? null;
    });
  }

  /** A single category plus its live event count (null if absent). */
  async findWithCount(
    organizationId: number,
    id: number,
  ): Promise<CategoryWithCount | null> {
    const row = await this.findCategory(organizationId, id);
    if (!row) return null;
    return { ...row, eventCount: await this.countEvents(organizationId, id) };
  }

  /** How many live events currently use this category (delete guard). */
  async countEvents(organizationId: number, id: number): Promise<number> {
    const counts = await this.countsFor(organizationId, [id]);
    return counts.get(id) ?? 0;
  }

  /** Optimistic update: writes only when `version` still matches, bumping it. */
  async update(
    organizationId: number,
    id: number,
    values: Partial<NewCategoryValues>,
    currentVersion: number,
  ): Promise<CategoryRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .update(categories)
        .set({ ...values, version: currentVersion + 1, updatedAt: new Date() })
        .where(
          and(
            this.byId(organizationId, id),
            eq(categories.version, currentVersion),
          ),
        )
        .returning();
      return row ?? null;
    });
  }

  async softDelete(organizationId: number, id: number): Promise<void> {
    await withTenant(this.db, organizationId, async (tx) => {
      await tx
        .update(categories)
        .set({ deletedAt: new Date() })
        .where(this.byId(organizationId, id));
    });
  }

  /** Live event counts keyed by category id, in one grouped, tenant-scoped query. */
  private async countsFor(
    organizationId: number,
    ids: number[],
  ): Promise<Map<number, number>> {
    if (ids.length === 0) return new Map();
    return withTenant(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select({
          categoryId: events.categoryId,
          count: sql<number>`count(*)::int`,
        })
        .from(events)
        .where(
          and(
            eq(events.organizationId, organizationId),
            isNull(events.deletedAt),
            inArray(events.categoryId, ids),
          ),
        )
        .groupBy(events.categoryId);
      return new Map(
        rows.flatMap((r) =>
          r.categoryId === null ? [] : [[r.categoryId, r.count] as const],
        ),
      );
    });
  }

  private byId(organizationId: number, id: number): SQL {
    return and(
      eq(categories.id, id),
      eq(categories.organizationId, organizationId),
      isNull(categories.deletedAt),
    ) as SQL;
  }
}

/** Escape LIKE/ILIKE metacharacters so `%`/`_` in a search term match literally. */
function likeEscape(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Sort columns, always with a unique `id` tiebreaker so paging can't skip/dup. */
function orderColumns(sort: CategorySort): SQL[] {
  const tiebreaker = asc(categories.id);
  if (sort === 'recent') return [desc(categories.createdAt), tiebreaker];
  return [asc(categories.name), tiebreaker];
}
