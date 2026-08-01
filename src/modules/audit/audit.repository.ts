import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { auditEvents, users } from '../../db/schema';
import { withTenant } from '../../db/tenant';

export type AuditRow = typeof auditEvents.$inferSelect;

export interface AuditQuery {
  /** Restrict to one actor — used to scope a non-Admin to their own events. */
  actorUserId?: string;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

export interface AuditRecord {
  id: number;
  type: string;
  title: string;
  meta: string | null;
  actorUserId: string | null;
  actorName: string | null;
  ipAddress: string | null;
  occurredAt: Date;
}

/**
 * Reads the append-only audit trail. There is deliberately **no update or delete**
 * here — entries cannot be edited or removed from anywhere in the product.
 */
@Injectable()
export class AuditRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async page(
    organizationId: number,
    query: AuditQuery,
  ): Promise<{ items: AuditRecord[]; total: number }> {
    return withTenant(this.db, organizationId, async (tx) => {
      const where = this.filter(organizationId, query);
      const rows = await tx
        .select({
          id: auditEvents.id,
          type: auditEvents.type,
          title: auditEvents.title,
          meta: auditEvents.meta,
          actorUserId: auditEvents.actorUserId,
          actorName: users.name,
          ipAddress: auditEvents.ipAddress,
          occurredAt: auditEvents.occurredAt,
        })
        .from(auditEvents)
        .leftJoin(users, eq(users.id, auditEvents.actorUserId))
        .where(where)
        .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
        .limit(query.limit)
        .offset(query.offset);
      const all = await tx
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(where);
      return { items: rows, total: all.length };
    });
  }

  /** Every matching row, newest-first — for an export (no paging). */
  async all(
    organizationId: number,
    query: Omit<AuditQuery, 'limit' | 'offset'>,
  ): Promise<AuditRecord[]> {
    const { items } = await this.page(organizationId, {
      ...query,
      limit: Number.MAX_SAFE_INTEGER,
      offset: 0,
    });
    return items;
  }

  /** Record the export itself — an export is an audited action. */
  async recordExport(
    organizationId: number,
    actorUserId: string,
    title: string,
  ): Promise<void> {
    await withTenant(this.db, organizationId, async (tx) => {
      await tx
        .insert(auditEvents)
        .values({ organizationId, type: 'xport', title, actorUserId });
    });
  }

  private filter(organizationId: number, query: AuditQuery): SQL | undefined {
    const clauses = [eq(auditEvents.organizationId, organizationId)];
    if (query.actorUserId) {
      clauses.push(eq(auditEvents.actorUserId, query.actorUserId));
    }
    if (query.from) clauses.push(gte(auditEvents.occurredAt, query.from));
    if (query.to) clauses.push(lte(auditEvents.occurredAt, query.to));
    return and(...clauses);
  }
}
