import { Inject, Injectable } from '@nestjs/common';
import {
  type SQL,
  and,
  asc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { meetings } from '../../db/schema';
import { type Tx, withTenant } from '../../db/tenant';
import { OutboxPort, type OutboxEventInput } from '../platform/outbox.port';
import type { MeetingBucket } from './meeting-bucket';
import type {
  MeetingCounts,
  MeetingFilters,
  MeetingRow,
  NewMeeting,
  MeetingPatch,
} from './meetings.types';

/** Today in BANGKOK, decided by the database so every row is judged alike. */
const TODAY = sql`(now() AT TIME ZONE 'Asia/Bangkok')::date`;

/**
 * Data access for meetings (E12).
 *
 * The today/upcoming/past split is computed in SQL against the Bangkok
 * calendar day rather than read from a stored column, so the tabs are correct
 * the instant the day turns — and the tab counts come from the same predicate
 * builder as the page, so the numbers can never describe a different list.
 */
@Injectable()
export class MeetingsRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly outbox: OutboxPort,
  ) {}

  /**
   * Create the meeting and ask for its calendar invite in ONE transaction.
   *
   * `ON CONFLICT … DO NOTHING` on the organizer's key makes a double-submitted
   * panel resolve to the booking it already made: the second attempt inserts
   * nothing, re-reads the first, and — crucially — does NOT enqueue a second
   * sync, so the guest is never invited twice (US-MTG-03).
   */
  async schedule(
    organizationId: number,
    input: NewMeeting,
    buildSync: (row: MeetingRow) => OutboxEventInput,
  ): Promise<{ meeting: MeetingRow; created: boolean }> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [inserted] = await tx
        .insert(meetings)
        .values({ organizationId, ...input })
        .onConflictDoNothing({
          target: [meetings.organizationId, meetings.idempotencyKey],
        })
        .returning();
      if (!inserted) {
        const existing = await this.byIdempotencyKey(tx, organizationId, input);
        return { meeting: existing, created: false };
      }
      await this.outbox.enqueueIn(tx, buildSync(inserted));
      return { meeting: inserted, created: true };
    });
  }

  /**
   * Apply an edit, but only to the version the organizer was looking at.
   *
   * The `version` predicate is the whole guard: if someone else saved first the
   * update matches no row, and the caller is told to reload rather than
   * silently flattening the other edit (US-MTG-05).
   */
  async reschedule(
    organizationId: number,
    id: string,
    expectedVersion: number,
    patch: MeetingPatch,
    buildSync: (row: MeetingRow) => OutboxEventInput,
  ): Promise<MeetingRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [updated] = await tx
        .update(meetings)
        .set({
          ...patch,
          // Back to pending: the guest's invite now describes the old time, so
          // it is not synced again until the worker has amended it.
          syncStatus: 'pending',
          syncError: null,
          updatedAt: new Date(),
          version: expectedVersion + 1,
        })
        .where(
          and(
            eq(meetings.id, id),
            eq(meetings.organizationId, organizationId),
            eq(meetings.version, expectedVersion),
            eq(meetings.status, 'scheduled'),
            isNull(meetings.deletedAt),
          ),
        )
        .returning();
      if (!updated) return null;
      await this.outbox.enqueueIn(tx, buildSync(updated));
      return updated;
    });
  }

  /** Call it off, keep the record, and withdraw the guest's invite. */
  async cancel(
    organizationId: number,
    id: string,
    reason: string | null,
    buildSync: (row: MeetingRow) => OutboxEventInput,
  ): Promise<MeetingRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const now = new Date();
      const [cancelled] = await tx
        .update(meetings)
        .set({
          status: 'cancelled',
          cancellationReason: reason,
          cancelledAt: now,
          syncStatus: 'pending',
          updatedAt: now,
        })
        .where(
          and(
            eq(meetings.id, id),
            eq(meetings.organizationId, organizationId),
            eq(meetings.status, 'scheduled'),
            isNull(meetings.deletedAt),
          ),
        )
        .returning();
      if (!cancelled) return null;
      await this.outbox.enqueueIn(tx, buildSync(cancelled));
      return cancelled;
    });
  }

  /** Ask the calendar again for a meeting whose sync did not land (US-MTG-04). */
  async retrySync(
    organizationId: number,
    id: string,
    buildSync: (row: MeetingRow) => OutboxEventInput,
  ): Promise<MeetingRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .update(meetings)
        .set({ syncStatus: 'pending', syncError: null, updatedAt: new Date() })
        .where(
          and(
            eq(meetings.id, id),
            eq(meetings.organizationId, organizationId),
            isNull(meetings.deletedAt),
          ),
        )
        .returning();
      if (!row) return null;
      await this.outbox.enqueueIn(tx, buildSync(row));
      return row;
    });
  }

  async findById(
    organizationId: number,
    id: string,
  ): Promise<MeetingRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select()
        .from(meetings)
        .where(
          and(
            eq(meetings.id, id),
            eq(meetings.organizationId, organizationId),
            isNull(meetings.deletedAt),
          ),
        )
        .limit(1);
      return row ?? null;
    });
  }

  async page(
    organizationId: number,
    filters: MeetingFilters,
  ): Promise<{ items: MeetingRow[]; total: number }> {
    return withTenant(this.db, organizationId, async (tx) => {
      const where = this.listWhere(organizationId, filters);
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(meetings)
        .where(where);
      const items = await tx
        .select()
        .from(meetings)
        .where(where)
        // Earliest first within a day — the order the story asks Upcoming for,
        // and the order a day's agenda is actually worked through.
        .orderBy(asc(meetings.meetingDate), asc(meetings.startTime))
        .limit(filters.limit)
        .offset((filters.page - 1) * filters.limit);
      return { items, total: count };
    });
  }

  /** Every tab total in ONE scan, so they describe the same instant. */
  async countByBucket(
    organizationId: number,
    filters: Omit<MeetingFilters, 'bucket'>,
  ): Promise<MeetingCounts> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({
          all: sql<number>`count(*)::int`,
          today: sql<number>`count(*) FILTER (WHERE ${meetings.meetingDate} = ${TODAY})::int`,
          upcoming: sql<number>`count(*) FILTER (WHERE ${meetings.meetingDate} > ${TODAY})::int`,
          past: sql<number>`count(*) FILTER (WHERE ${meetings.meetingDate} < ${TODAY})::int`,
        })
        .from(meetings)
        .where(this.listWhere(organizationId, filters));
      return row;
    });
  }

  private async byIdempotencyKey(
    tx: Tx,
    organizationId: number,
    input: NewMeeting,
  ): Promise<MeetingRow> {
    const [row] = await tx
      .select()
      .from(meetings)
      .where(
        and(
          eq(meetings.organizationId, organizationId),
          eq(meetings.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    return row;
  }

  private listWhere(
    organizationId: number,
    filters: Omit<MeetingFilters, 'bucket'> & { bucket?: MeetingBucket },
  ): SQL | undefined {
    const clauses: (SQL | undefined)[] = [
      eq(meetings.organizationId, organizationId),
      isNull(meetings.deletedAt),
    ];
    if (filters.bucket) clauses.push(this.bucketWhere(filters.bucket));
    if (filters.type) clauses.push(eq(meetings.type, filters.type));
    if (filters.eventId) clauses.push(eq(meetings.eventId, filters.eventId));
    if (filters.search) {
      const term = `%${filters.search}%`;
      clauses.push(
        or(
          ilike(meetings.title, term),
          ilike(meetings.person, term),
          ilike(meetings.role, term),
          // The type is matched as text so "sponsor" finds Sponsor meetings.
          ilike(sql`${meetings.type}::text`, term),
          // Events whose NAME matched, resolved by their owner beforehand — so
          // "jazz" finds meetings about the Jazz Festival, not just ones titled
          // "jazz". An empty list must match nothing, never everything.
          filters.eventIds && filters.eventIds.length > 0
            ? inArray(meetings.eventId, filters.eventIds)
            : undefined,
        ),
      );
    }
    return and(...clauses);
  }

  private bucketWhere(bucket: MeetingBucket): SQL {
    if (bucket === 'today') return eq(meetings.meetingDate, TODAY as never);
    if (bucket === 'upcoming') return gt(meetings.meetingDate, TODAY as never);
    return lt(meetings.meetingDate, TODAY as never);
  }
}
