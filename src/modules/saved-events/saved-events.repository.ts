import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { savedEvents } from '../../db/schema';
import type { SavedEventsPage } from './saved-events.types';

/**
 * Data access for an attendee's saved events (US-DISC-03). Scoped by `user_id`,
 * never by organization: a saved list spans every workspace whose events the
 * attendee liked, which is exactly why `saved_events` carries no tenant column.
 */
@Injectable()
export class SavedEventsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Save, idempotently — tapping the heart twice leaves one row, not an error. */
  async save(userId: string, eventId: string): Promise<void> {
    await this.db
      .insert(savedEvents)
      .values({ userId, eventId })
      .onConflictDoNothing();
  }

  /** Adopt a guest's in-session saves; returns how many were genuinely new. */
  async saveMany(userId: string, eventIds: string[]): Promise<number> {
    if (eventIds.length === 0) return 0;
    const inserted = await this.db
      .insert(savedEvents)
      .values(eventIds.map((eventId) => ({ userId, eventId })))
      .onConflictDoNothing()
      .returning({ id: savedEvents.id });
    return inserted.length;
  }

  /** Remove a save. Removing one that was never there is a no-op, not an error. */
  async unsave(userId: string, eventId: string): Promise<void> {
    await this.db
      .delete(savedEvents)
      .where(
        and(eq(savedEvents.userId, userId), eq(savedEvents.eventId, eventId)),
      );
  }

  /** A page of saved event ids, most recently saved first, plus the total. */
  async listEventIds(
    userId: string,
    page: SavedEventsPage,
  ): Promise<{ ids: string[]; total: number }> {
    const mine = eq(savedEvents.userId, userId);
    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(savedEvents)
      .where(mine);
    const rows = await this.db
      .select({ eventId: savedEvents.eventId })
      .from(savedEvents)
      .where(mine)
      // A unique tiebreaker so paging can't skip or repeat a save.
      .orderBy(desc(savedEvents.savedAt), desc(savedEvents.id))
      .limit(page.limit)
      .offset(page.offset);
    return { ids: rows.map((r) => r.eventId), total: count };
  }

  /** Which of these events this attendee has already saved (for the heart state). */
  async savedAmong(userId: string, eventIds: string[]): Promise<Set<string>> {
    const ids = [...new Set(eventIds)];
    if (ids.length === 0) return new Set();
    const rows = await this.db
      .select({ eventId: savedEvents.eventId })
      .from(savedEvents)
      .where(
        and(eq(savedEvents.userId, userId), inArray(savedEvents.eventId, ids)),
      );
    return new Set(rows.map((r) => r.eventId));
  }
}
