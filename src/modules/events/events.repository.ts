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
import { events, organizations } from '../../db/schema';
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

  async insert(values: NewEventValues): Promise<EventRow> {
    return withTenant(this.db, values.organizationId, async (tx) => {
      const [row] = await tx.insert(events).values(values).returning();
      return row;
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
        .orderBy(orderColumn(opts.sort))
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
      opts.q ? ilike(events.name, `%${opts.q}%`) : undefined,
    ];
    return and(...filters) as SQL;
  }
}

function orderColumn(sort: EventSort): SQL {
  if (sort === 'name') return asc(events.name);
  if (sort === 'date') return asc(events.startAt);
  return desc(events.createdAt);
}
