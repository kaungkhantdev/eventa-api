import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { sessionSpeakers, sessions, speakers } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import type { NewSpeakerValues, SpeakerRow } from './speakers.types';

/** Data access for speakers (Events & Program context). All queries tenant-scoped. */
@Injectable()
export class SpeakersRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async insert(values: NewSpeakerValues): Promise<SpeakerRow> {
    return withTenant(this.db, values.organizationId, async (tx) => {
      const [row] = await tx.insert(speakers).values(values).returning();
      return row;
    });
  }

  /**
   * How many LIVE sessions each of `speakerIds` is booked into (US-PROG-08).
   * Soft-deleted sessions are excluded, which is what makes a removed session
   * drop its speakers' counts by one (US-PROG-04) without touching any link
   * row. Speakers with no sessions are simply absent from the map.
   */
  async sessionCounts(
    organizationId: number,
    speakerIds: string[],
  ): Promise<Map<string, number>> {
    if (speakerIds.length === 0) return new Map();
    return withTenant(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select({
          speakerId: sessionSpeakers.speakerId,
          count: sql<number>`count(*)::int`,
        })
        .from(sessionSpeakers)
        .innerJoin(sessions, eq(sessions.id, sessionSpeakers.sessionId))
        .where(
          and(
            eq(sessions.organizationId, organizationId),
            inArray(sessionSpeakers.speakerId, speakerIds),
            isNull(sessions.deletedAt),
          ),
        )
        .groupBy(sessionSpeakers.speakerId);
      return new Map(rows.map((r) => [r.speakerId, Number(r.count)]));
    });
  }

  /** The event's live speakers, ordered by name (card order). */
  async listByEvent(
    organizationId: number,
    eventId: string,
  ): Promise<SpeakerRow[]> {
    return withTenant(this.db, organizationId, async (tx) => {
      return tx
        .select()
        .from(speakers)
        .where(
          and(
            eq(speakers.organizationId, organizationId),
            eq(speakers.eventId, eventId),
            isNull(speakers.deletedAt),
          ),
        )
        .orderBy(asc(speakers.name), asc(speakers.id));
    });
  }

  /** A single live speaker scoped to the org + event (null if absent). */
  async findSpeaker(
    organizationId: number,
    eventId: string,
    speakerId: string,
  ): Promise<SpeakerRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select()
        .from(speakers)
        .where(this.byId(organizationId, eventId, speakerId))
        .limit(1);
      return row ?? null;
    });
  }

  /** Optimistic update: writes only when `version` still matches, bumping it. */
  async update(
    organizationId: number,
    speakerId: string,
    values: Partial<NewSpeakerValues>,
    currentVersion: number,
  ): Promise<SpeakerRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .update(speakers)
        .set({ ...values, version: currentVersion + 1, updatedAt: new Date() })
        .where(
          and(
            eq(speakers.id, speakerId),
            eq(speakers.organizationId, organizationId),
            eq(speakers.version, currentVersion),
            isNull(speakers.deletedAt),
          ),
        )
        .returning();
      return row ?? null;
    });
  }

  async softDelete(organizationId: number, speakerId: string): Promise<void> {
    await withTenant(this.db, organizationId, async (tx) => {
      await tx
        .update(speakers)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(speakers.id, speakerId),
            eq(speakers.organizationId, organizationId),
          ),
        );
    });
  }

  private byId(
    organizationId: number,
    eventId: string,
    speakerId: string,
  ): SQL {
    return and(
      eq(speakers.id, speakerId),
      eq(speakers.organizationId, organizationId),
      eq(speakers.eventId, eventId),
      isNull(speakers.deletedAt),
    ) as SQL;
  }
}
