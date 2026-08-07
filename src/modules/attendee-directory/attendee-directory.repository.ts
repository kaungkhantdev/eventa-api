import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { withTenant } from '../../db/tenant';
import type {
  AttendeeRow,
  DirectoryFilters,
  SegmentCounts,
} from './attendee-directory.types';

/** An attendee is "new" if this workspace first saw them within 30 days. */
const NEW_WINDOW_DAYS = 30;

/**
 * Data access for the attendee directory (US-REG-05).
 *
 * Every row needs three aggregates — events attended, tickets held, and how
 * many of those were checked in — so the query builds them once in a lateral
 * subquery rather than issuing three counts per attendee. The same expression
 * feeds the segment counts, so a segment tab can never disagree with the list.
 */
@Injectable()
export class AttendeeDirectoryRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async page(
    organizationId: number,
    filters: DirectoryFilters,
  ): Promise<{ items: AttendeeRow[]; total: number }> {
    return withTenant(this.db, organizationId, async (tx) => {
      const where = this.directoryWhere(filters);
      const rows = await tx.execute<Record<string, unknown>>(sql`
        WITH stats AS (${this.statsCte(organizationId)})
        SELECT s.*, count(*) OVER () AS total_rows
          FROM stats s
         WHERE ${where}
         ORDER BY ${this.orderBy(filters.sort)}
         LIMIT ${filters.limit}
        OFFSET ${(filters.page - 1) * filters.limit}
      `);
      const total = rows.rows.length > 0 ? Number(rows.rows[0].total_rows) : 0;
      return {
        items: rows.rows.map(toRow),
        total: await this.total(tx, organizationId, filters, total),
      };
    });
  }

  async counts(
    organizationId: number,
    filters: Omit<DirectoryFilters, 'segment'>,
  ): Promise<SegmentCounts> {
    return withTenant(this.db, organizationId, async (tx) => {
      const where = this.directoryWhere({ ...filters, segment: undefined });
      const result = await tx.execute<Record<string, string>>(sql`
        WITH stats AS (${this.statsCte(organizationId)})
        SELECT count(*)::int AS all_count,
               count(*) FILTER (WHERE first_seen_at > now() - interval '${sql.raw(String(NEW_WINDOW_DAYS))} days')::int AS new_count,
               count(*) FILTER (WHERE checked_in_count > 0)::int AS checked_in_count,
               count(*) FILTER (WHERE tag = 'VIP')::int AS vip_count
          FROM stats s
         WHERE ${where}
      `);
      const row = result.rows[0];
      return {
        all: Number(row.all_count),
        new: Number(row.new_count),
        checkedIn: Number(row.checked_in_count),
        vip: Number(row.vip_count),
      };
    });
  }

  /** One pass over the attendee's registrations, reused by page and counts. */
  private statsCte(organizationId: number) {
    return sql`
      SELECT a.id, a.name, a.email, a.phone, a.company, a.tag, a.first_seen_at,
             agg.last_activity_at,
             coalesce(agg.event_count, 0)      AS event_count,
             coalesce(agg.ticket_count, 0)     AS ticket_count,
             coalesce(agg.checked_in_count, 0) AS checked_in_count
        FROM attendees a
        LEFT JOIN LATERAL (
          SELECT max(o.registered_at)                        AS last_activity_at,
                 count(DISTINCT o.event_id)                  AS event_count,
                 count(t.id)                                 AS ticket_count,
                 count(t.id) FILTER (WHERE t.status = 'checked_in') AS checked_in_count
            FROM orders o
            LEFT JOIN tickets t ON t.order_id = o.id
           WHERE o.attendee_id = a.id
             AND o.organization_id = ${organizationId}
             AND o.status <> 'cancelled'
        ) agg ON true
       WHERE a.organization_id = ${organizationId}
         AND a.deleted_at IS NULL
    `;
  }

  private directoryWhere(filters: Partial<DirectoryFilters>) {
    const clauses = [sql`true`];
    if (filters.segment === 'new') {
      clauses.push(
        sql`first_seen_at > now() - interval '${sql.raw(String(NEW_WINDOW_DAYS))} days'`,
      );
    }
    if (filters.segment === 'checked_in') {
      clauses.push(sql`checked_in_count > 0`);
    }
    if (filters.segment === 'vip') clauses.push(sql`tag = 'VIP'`);
    if (filters.tag) clauses.push(sql`tag = ${filters.tag}`);
    if (filters.search) {
      const term = `%${filters.search}%`;
      clauses.push(sql`(name ILIKE ${term} OR email ILIKE ${term})`);
    }
    return sql.join(clauses, sql` AND `);
  }

  /** Ties always break on recent activity, so ordering is never arbitrary. */
  private orderBy(sort: DirectoryFilters['sort']) {
    const recent = sql`last_activity_at DESC NULLS LAST, id DESC`;
    if (sort === 'name') return sql`name ASC, ${recent}`;
    if (sort === 'events') return sql`event_count DESC, ${recent}`;
    if (sort === 'tickets') return sql`ticket_count DESC, ${recent}`;
    return recent;
  }

  private async total(
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    organizationId: number,
    filters: DirectoryFilters,
    windowTotal: number,
  ): Promise<number> {
    if (windowTotal > 0) return windowTotal;
    // An empty page still needs a truthful total (e.g. page 5 of 2 pages).
    const result = await tx.execute<{ total: string }>(sql`
      WITH stats AS (${this.statsCte(organizationId)})
      SELECT count(*)::int AS total FROM stats s WHERE ${this.directoryWhere(filters)}
    `);
    return Number(result.rows[0].total);
  }
}

function toRow(row: Record<string, unknown>): AttendeeRow {
  return {
    id: Number(row.id),
    name: row.name as string,
    email: row.email as string,
    phone: (row.phone as string | null) ?? null,
    company: (row.company as string | null) ?? null,
    tag: (row.tag as AttendeeRow['tag']) ?? null,
    firstSeenAt: new Date(row.first_seen_at as string),
    lastActivityAt: row.last_activity_at
      ? new Date(row.last_activity_at as string)
      : null,
    eventCount: Number(row.event_count),
    ticketCount: Number(row.ticket_count),
    checkedInCount: Number(row.checked_in_count),
  };
}
