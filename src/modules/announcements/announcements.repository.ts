import { Inject, Injectable } from '@nestjs/common';
import { type SQL, and, count, desc, eq, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { announcements, events } from '../../db/schema';
import { type Tx, withTenant } from '../../db/tenant';
import { OutboxPort, type OutboxEventInput } from '../platform/outbox.port';
import {
  type AnnouncementStatus,
  CANCELLED,
  SCHEDULED,
} from './announcement-schedule';

export type AnnouncementRow = typeof announcements.$inferSelect;

export interface NewAnnouncement {
  eventId: string;
  subject: string;
  body: string;
  recipientCount: number;
  sentByUserId: string;
  sentAt: Date;
}

/** One to send later (US-MSG-04). No count: its audience is resolved when it goes. */
export interface NewScheduledAnnouncement {
  eventId: string;
  subject: string;
  body: string;
  sentByUserId: string;
  scheduledFor: Date;
}

/** An announcement in the history, with the event it went to named. */
export interface AnnouncementListRow {
  id: string;
  eventId: string;
  /** Null when the event has since been deleted — the send still happened. */
  eventName: string | null;
  subject: string;
  body: string;
  status: AnnouncementStatus;
  /** Null for one that was sent straight away. */
  scheduledFor: Date | null;
  /** Null until it has gone. */
  sentAt: Date | null;
  cancelledAt: Date | null;
  /** Null until it has gone — NOT 0, which would say it was counted and found nobody. */
  recipientCount: number | null;
}

export interface AnnouncementPage {
  rows: AnnouncementListRow[];
  total: number;
}

@Injectable()
export class AnnouncementsRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly outbox: OutboxPort,
  ) {}

  /**
   * Write the record and enqueue the send in ONE transaction.
   *
   * This is the whole reason the table earns its place. An announcement listed
   * but never sent is a lie to the organizer; one sent but never listed is a
   * broadcast to hundreds of people with no trace of who did it. Either on its
   * own is worse than neither, so they commit together or not at all.
   */
  async record(
    organizationId: number,
    input: NewAnnouncement,
    send: OutboxEventInput,
  ): Promise<AnnouncementRow> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .insert(announcements)
        .values({ organizationId, ...input })
        .returning();
      await this.outbox.enqueueIn(tx, send);
      return row;
    });
  }

  /**
   * Write one to send later — the row alone, with NO outbox event.
   *
   * The send is written by eventa-worker when its time comes, in the same
   * transaction that marks this row sent. An outbox event now would email
   * everybody now.
   */
  async recordScheduled(
    organizationId: number,
    input: NewScheduledAnnouncement,
  ): Promise<AnnouncementRow> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .insert(announcements)
        .values({ organizationId, ...input, status: SCHEDULED })
        .returning();
      return row;
    });
  }

  /**
   * Cancel one that has not gone. Null when there is nothing scheduled to
   * cancel — missing, another workspace's, or already settled.
   *
   * The condition is IN the UPDATE, not checked beforehand. eventa-worker's
   * sweep locks a due row while it sends it; this UPDATE waits for that lock,
   * then re-checks `status` against the committed row (READ COMMITTED), finds
   * it `sent`, and changes nothing. A read-then-write would cancel an
   * announcement that had just gone out.
   */
  async cancel(
    organizationId: number,
    id: number,
    by: { userId: string; now: Date },
  ): Promise<AnnouncementListRow | null> {
    return this.changeScheduled(organizationId, id, {
      status: CANCELLED,
      cancelledAt: by.now,
      cancelledByUserId: by.userId,
      updatedAt: by.now,
    });
  }

  /** Move one that has not gone to a new time. Null as for `cancel`, and for the same reason. */
  async reschedule(
    organizationId: number,
    id: number,
    to: { sendAt: Date; now: Date },
  ): Promise<AnnouncementListRow | null> {
    return this.changeScheduled(organizationId, id, {
      scheduledFor: to.sendAt,
      updatedAt: to.now,
    });
  }

  /** One announcement as the history shows it, or null if it is not the caller's. */
  async find(
    organizationId: number,
    id: number,
  ): Promise<AnnouncementListRow | null> {
    return withTenant(this.db, organizationId, (tx) =>
      this.findIn(tx, organizationId, id),
    );
  }

  private async changeScheduled(
    organizationId: number,
    id: number,
    change: Partial<typeof announcements.$inferInsert>,
  ): Promise<AnnouncementListRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [changed] = await tx
        .update(announcements)
        .set(change)
        .where(
          and(
            eq(announcements.id, id),
            eq(announcements.organizationId, organizationId),
            eq(announcements.status, SCHEDULED),
          ),
        )
        .returning({ id: announcements.id });
      return changed ? this.findIn(tx, organizationId, id) : null;
    });
  }

  private async findIn(
    tx: Tx,
    organizationId: number,
    id: number,
  ): Promise<AnnouncementListRow | null> {
    const [row] = await this.listed(tx)
      .where(
        and(
          eq(announcements.organizationId, organizationId),
          eq(announcements.id, id),
        ),
      )
      .limit(1);
    return row ? toListRow(row) : null;
  }

  /**
   * The history's columns, left-joined to events: an announcement outlives the
   * event it was about, and dropping the row because the event is gone would
   * erase the record of a message that really did reach people.
   */
  private listed(tx: Tx) {
    return tx
      .select({
        id: announcements.id,
        eventId: announcements.eventId,
        eventName: events.name,
        subject: announcements.subject,
        body: announcements.body,
        status: announcements.status,
        scheduledFor: announcements.scheduledFor,
        sentAt: announcements.sentAt,
        cancelledAt: announcements.cancelledAt,
        recipientCount: announcements.recipientCount,
      })
      .from(announcements)
      .leftJoin(events, eq(events.id, announcements.eventId))
      .$dynamic();
  }

  /**
   * Newest first — an announcements list is a history, and the last thing sent
   * is the one somebody is checking on.
   */
  async list(
    organizationId: number,
    filter: { eventId?: string; page: number; limit: number },
  ): Promise<AnnouncementPage> {
    const where = and(
      eq(announcements.organizationId, organizationId),
      filter.eventId ? eq(announcements.eventId, filter.eventId) : undefined,
    );

    return withTenant(this.db, organizationId, async (tx) => {
      const [{ total }] = await tx
        .select({ total: count() })
        .from(announcements)
        .where(where);

      const rows = await this.listed(tx)
        .where(where)
        .orderBy(desc(whenItGoes()), desc(announcements.id))
        .limit(filter.limit)
        .offset((filter.page - 1) * filter.limit);

      return { total: Number(total), rows: rows.map(toListRow) };
    });
  }
}

/**
 * When it went, or is (was) due to. A scheduled one sits by its time — at the
 * top while it is still to come — and a cancelled one stays where it would have
 * been.
 */
function whenItGoes(): SQL {
  return sql`coalesce(${announcements.sentAt}, ${announcements.scheduledFor})`;
}

type ListedRow = Omit<AnnouncementListRow, 'id'> & { id: number };

/**
 * The id as a string, as every bigint id leaves this API. The count is left
 * alone: `Number(null)` is 0, which is exactly the "counted nobody" a
 * scheduled row must not claim.
 */
function toListRow(row: ListedRow): AnnouncementListRow {
  return { ...row, id: String(row.id) };
}
