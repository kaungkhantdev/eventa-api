import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { announcements, events } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import { OutboxPort, type OutboxEventInput } from '../platform/outbox.port';

export type AnnouncementRow = typeof announcements.$inferSelect;

export interface NewAnnouncement {
  eventId: string;
  subject: string;
  body: string;
  recipientCount: number;
  sentByUserId: string;
  sentAt: Date;
}

/** A sent announcement, with the event it went to named. */
export interface AnnouncementListRow {
  id: string;
  eventId: string;
  /** Null when the event has since been deleted — the send still happened. */
  eventName: string | null;
  subject: string;
  body: string;
  recipientCount: number;
  sentAt: Date;
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
   * Newest first — an announcements list is a history, and the last thing sent
   * is the one somebody is checking on.
   *
   * Left-joined to events: an announcement outlives the event it was about, and
   * dropping the row because the event is gone would erase the record of a
   * message that really did reach people.
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

      const rows = await tx
        .select({
          id: announcements.id,
          eventId: announcements.eventId,
          eventName: events.name,
          subject: announcements.subject,
          body: announcements.body,
          recipientCount: announcements.recipientCount,
          sentAt: announcements.sentAt,
        })
        .from(announcements)
        .leftJoin(events, eq(events.id, announcements.eventId))
        .where(where)
        .orderBy(desc(announcements.sentAt), desc(announcements.id))
        .limit(filter.limit)
        .offset((filter.page - 1) * filter.limit);

      return {
        total: Number(total),
        rows: rows.map((row) => ({
          ...row,
          id: String(row.id),
          recipientCount: Number(row.recipientCount),
        })),
      };
    });
  }
}
