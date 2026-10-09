import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { attendees, auditEvents, orders } from '../../db/schema';
import { withTenant, type Tx } from '../../db/tenant';
import {
  CONTACT_AUDIT_TYPE,
  CONTACT_AUDIT_TITLE,
  contactAuditMeta,
} from './attendee-contact.audit';
import type {
  AttendeeContactRow,
  AttendeeRow,
  ContactChanges,
  DirectoryFilters,
  EmailHolder,
  SaveContactInput,
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

  /** One directory row, with the same aggregates the list carries. */
  async findDirectoryEntry(
    organizationId: number,
    attendeeId: number,
  ): Promise<AttendeeRow | null> {
    return withTenant(this.db, organizationId, (tx) =>
      this.entry(tx, organizationId, attendeeId),
    );
  }

  /** The editable contact fields, plus the version a write is guarded by. */
  async findContact(
    organizationId: number,
    attendeeId: number,
  ): Promise<AttendeeContactRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select({
          id: attendees.id,
          name: attendees.name,
          email: attendees.email,
          phone: attendees.phone,
          version: attendees.version,
        })
        .from(attendees)
        .where(
          and(
            eq(attendees.organizationId, organizationId),
            eq(attendees.id, attendeeId),
            // A removed record is not editable: correcting one would bring a
            // departed person's details back into a directory that hides them.
            isNull(attendees.deletedAt),
          ),
        );
      return rows[0] ?? null;
    });
  }

  /**
   * Who in this workspace already holds an address (US-REG-08 AC3).
   *
   * **Soft-deleted attendees count**, and that is the decision this method
   * exists to make. `uq_attendees_org_email` carries no `WHERE deleted_at IS
   * NULL` predicate, so a removed record still owns its address: were this
   * lookup to skip removed rows, the service would approve the change and the
   * index would then reject the UPDATE with a bare SQLSTATE 23505 — the
   * organizer would get a failure where the story promises a merge prompt.
   * Checkout agrees: its `onConflictDoUpdate` on the same pair adopts a
   * soft-deleted row rather than inserting beside it, so in this schema a
   * removed attendee's address is taken, not free.
   *
   * The equality is Postgres's. `attendees.email` is `citext`, so this matches
   * `Rio@x.co` against a stored `rio@x.co` — which is what the question means.
   */
  async findAttendeeIdByEmail(
    organizationId: number,
    email: string,
  ): Promise<EmailHolder | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select({ id: attendees.id, deletedAt: attendees.deletedAt })
        .from(attendees)
        .where(
          and(
            eq(attendees.organizationId, organizationId),
            eq(attendees.email, email),
          ),
        );
      const row = rows[0];
      return row ? { id: row.id, removed: row.deletedAt !== null } : null;
    });
  }

  /**
   * Correct the record, re-point what messaging routes off, and record it —
   * in one transaction (US-REG-08 AC1, AC2, AC5).
   *
   * Returns null when the guarded UPDATE matches nothing, which means the row
   * moved between the service's read and this write.
   */
  async saveContact(
    organizationId: number,
    attendeeId: number,
    input: SaveContactInput,
  ): Promise<AttendeeRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const rows = await tx
        .update(attendees)
        .set({
          ...input.changes,
          updatedAt: input.now,
          // A literal, not `version + 1`: the WHERE below already pins the row
          // to this exact version, so the two cannot disagree.
          version: input.expectedVersion + 1,
        })
        .where(
          and(
            eq(attendees.organizationId, organizationId),
            eq(attendees.id, attendeeId),
            isNull(attendees.deletedAt),
            eq(attendees.version, input.expectedVersion),
          ),
        )
        .returning({ id: attendees.id });
      if (!rows[0]) return null;
      await this.repointMessageRouting(tx, organizationId, attendeeId, input);
      await this.recordContactEdit(tx, organizationId, attendeeId, input);
      return this.entry(tx, organizationId, attendeeId);
    });
  }

  /**
   * AC2 — "future confirmations and reminders go to the new number".
   *
   * It does NOT fall out of the messaging path for free: nothing downstream
   * reads `attendees`. Every send resolves its recipient from the order —
   * `EventRecipientsRepository.confirmedRecipients` groups reminders and
   * broadcasts by `orders.buyer_email`, and the confirmation SMS is addressed
   * from `orders.buyer_phone` (carried onto the `registration.confirmed`
   * payload). Those three columns are a denormalised copy of the contact
   * details, so correcting only the attendee row would leave the directory
   * right and every future message going to the old number.
   *
   * It is safe to rewrite them because the finance trail does not read through:
   * `invoices.buyer_name`/`buyer_email` are snapshotted at issue precisely so a
   * later correction cannot restate an issued tax invoice. `tickets.holder_name`
   * is left alone — an issued pass is a credential, not a routing copy — and so
   * is `discount_redemptions.buyer_email`, which is a ledger of what happened
   * and whose per-person limit must not be re-opened by a change of address.
   *
   * Every live order of this attendee's is re-pointed, cancelled ones included:
   * a cancelled or refunded order still mails its buyer, and that notice has to
   * reach the address they now have.
   */
  private async repointMessageRouting(
    tx: Tx,
    organizationId: number,
    attendeeId: number,
    input: SaveContactInput,
  ): Promise<void> {
    const routing = toBuyerColumns(input.changes);
    if (Object.keys(routing).length === 0) return;
    await tx
      .update(orders)
      .set({ ...routing, updatedAt: input.now })
      .where(
        and(
          eq(orders.organizationId, organizationId),
          eq(orders.attendeeId, attendeeId),
          isNull(orders.deletedAt),
        ),
      );
  }

  /**
   * The audit entry both AC1 and AC5 ask for — one row, through the trail this
   * codebase already keeps, written inside `withTenant` because the
   * `audit_events` RLS policy compares `organization_id` against
   * `app.current_org` and refuses the insert when it is unset.
   */
  private async recordContactEdit(
    tx: Tx,
    organizationId: number,
    attendeeId: number,
    input: SaveContactInput,
  ): Promise<void> {
    await tx.insert(auditEvents).values({
      organizationId,
      type: CONTACT_AUDIT_TYPE,
      title: CONTACT_AUDIT_TITLE,
      meta: contactAuditMeta(attendeeId, input.fields),
      actorUserId: input.actorUserId,
    });
  }

  /** The directory row for one attendee, inside a caller's transaction. */
  private async entry(
    tx: Tx,
    organizationId: number,
    attendeeId: number,
  ): Promise<AttendeeRow | null> {
    const result = await tx.execute<Record<string, unknown>>(sql`
      WITH stats AS (${this.statsCte(organizationId)})
      SELECT s.* FROM stats s WHERE s.id = ${attendeeId}
    `);
    const row = result.rows[0];
    return row ? toRow(row) : null;
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

/** The corrected fields, named as the columns messaging reads them from. */
function toBuyerColumns(changes: ContactChanges): Partial<{
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string | null;
}> {
  return {
    ...(changes.name !== undefined ? { buyerName: changes.name } : {}),
    ...(changes.email !== undefined ? { buyerEmail: changes.email } : {}),
    ...(changes.phone !== undefined ? { buyerPhone: changes.phone } : {}),
  };
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
