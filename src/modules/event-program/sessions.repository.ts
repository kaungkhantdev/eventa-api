import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, ne, type SQL } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { sessionSpeakers, sessions, speakers } from '../../db/schema';
import { type Tx, withTenant } from '../../db/tenant';
import { OutboxPort, type OutboxEventInput } from '../platform/outbox.port';
import type {
  NewSessionValues,
  SessionRow,
  SessionSpeakerRef,
  SpeakerClashCandidate,
} from './sessions.types';

/** Data access for agenda sessions + speaker links (Events & Program context). */
@Injectable()
export class SessionsRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly outbox: OutboxPort,
  ) {}

  /**
   * Insert a session and (optionally) its speaker links in ONE transaction, so the
   * `sessions` row and its `session_speakers` rows commit or roll back together.
   * `speakerIds === undefined` leaves the links untouched; `[]` clears them.
   */
  async createWithSpeakers(
    values: NewSessionValues,
    speakerIds: string[] | undefined,
  ): Promise<SessionRow> {
    return withTenant(this.db, values.organizationId, async (tx) => {
      const [row] = await tx.insert(sessions).values(values).returning();
      if (speakerIds !== undefined) {
        await this.writeSpeakers(tx, row.id, speakerIds);
      }
      return row;
    });
  }

  /**
   * Optimistically update a session and (optionally) rewrite its speaker links in
   * ONE transaction. Returns null when the version no longer matches (caller 409s)
   * — in which case nothing, including the links, is written.
   */
  async updateWithSpeakers(
    organizationId: number,
    sessionId: string,
    values: Partial<NewSessionValues>,
    currentVersion: number,
    speakerIds: string[] | undefined,
    /**
     * Built from the row that actually won the version race, so the notice can
     * never describe an update that was rolled back (US-PROG-03).
     */
    buildNotice?: (row: SessionRow) => OutboxEventInput,
  ): Promise<SessionRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .update(sessions)
        .set({ ...values, version: currentVersion + 1, updatedAt: new Date() })
        .where(
          and(
            eq(sessions.id, sessionId),
            eq(sessions.organizationId, organizationId),
            eq(sessions.version, currentVersion),
            isNull(sessions.deletedAt),
          ),
        )
        .returning();
      if (!row) return null;
      if (speakerIds !== undefined) {
        await this.writeSpeakers(tx, sessionId, speakerIds);
      }
      if (buildNotice) await this.outbox.enqueueIn(tx, buildNotice(row));
      return row;
    });
  }

  /** Replace a session's speaker links within an existing transaction (link order). */
  private async writeSpeakers(
    tx: Tx,
    sessionId: string,
    speakerIds: string[],
  ): Promise<void> {
    await tx
      .delete(sessionSpeakers)
      .where(eq(sessionSpeakers.sessionId, sessionId));
    if (speakerIds.length === 0) return;
    await tx.insert(sessionSpeakers).values(
      speakerIds.map((speakerId, i) => ({
        sessionId,
        speakerId,
        sortOrder: i,
      })),
    );
  }

  /** The event's live sessions, agenda order: day, then start time, then rank. */
  async listByEvent(
    organizationId: number,
    eventId: string,
  ): Promise<SessionRow[]> {
    return withTenant(this.db, organizationId, async (tx) => {
      return tx
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.organizationId, organizationId),
            eq(sessions.eventId, eventId),
            isNull(sessions.deletedAt),
          ),
        )
        .orderBy(
          asc(sessions.day),
          asc(sessions.startTime),
          asc(sessions.sortOrder),
          asc(sessions.id),
        );
    });
  }

  /** A single live session scoped to the org + event (null if absent). */
  async findSession(
    organizationId: number,
    eventId: string,
    sessionId: string,
  ): Promise<SessionRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select()
        .from(sessions)
        .where(this.byId(organizationId, eventId, sessionId))
        .limit(1);
      return row ?? null;
    });
  }

  async softDelete(organizationId: number, sessionId: string): Promise<void> {
    await withTenant(this.db, organizationId, async (tx) => {
      await tx
        .update(sessions)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(sessions.id, sessionId),
            eq(sessions.organizationId, organizationId),
          ),
        );
    });
  }

  /**
   * Live sessions on the same day already featuring any of `speakerIds`
   * (US-FIN-05's speaker-clash candidates). One row per session/speaker pair, so
   * the caller can name who is double-booked and in what.
   */
  async speakerSessions(
    organizationId: number,
    eventId: string,
    day: number,
    speakerIds: string[],
    excludeId?: string,
  ): Promise<SpeakerClashCandidate[]> {
    if (speakerIds.length === 0) return [];
    return withTenant(this.db, organizationId, async (tx) =>
      tx
        .select({
          sessionId: sessions.id,
          title: sessions.title,
          startTime: sessions.startTime,
          endTime: sessions.endTime,
          speakerName: speakers.name,
        })
        .from(sessionSpeakers)
        .innerJoin(sessions, eq(sessions.id, sessionSpeakers.sessionId))
        .innerJoin(speakers, eq(speakers.id, sessionSpeakers.speakerId))
        .where(
          and(
            eq(sessions.organizationId, organizationId),
            eq(sessions.eventId, eventId),
            eq(sessions.day, day),
            inArray(sessionSpeakers.speakerId, speakerIds),
            isNull(sessions.deletedAt),
            excludeId ? ne(sessions.id, excludeId) : undefined,
          ),
        ),
    );
  }

  /** The speakers a session already has — used when a PATCH doesn't resend them. */
  async currentSpeakerIds(
    organizationId: number,
    sessionId: string,
  ): Promise<string[]> {
    return withTenant(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select({ speakerId: sessionSpeakers.speakerId })
        .from(sessionSpeakers)
        .where(eq(sessionSpeakers.sessionId, sessionId));
      return rows.map((r) => r.speakerId);
    });
  }

  /** Live sessions in the same room on the same day (overlap-warning candidates). */
  async sameRoomSessions(
    organizationId: number,
    eventId: string,
    day: number,
    room: string,
    excludeId?: string,
  ): Promise<SessionRow[]> {
    return withTenant(this.db, organizationId, async (tx) => {
      return tx
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.organizationId, organizationId),
            eq(sessions.eventId, eventId),
            eq(sessions.day, day),
            eq(sessions.room, room),
            isNull(sessions.deletedAt),
            excludeId ? ne(sessions.id, excludeId) : undefined,
          ),
        );
    });
  }

  /** Which of `ids` are live speakers of this event (validates session links). */
  async validSpeakerIds(
    organizationId: number,
    eventId: string,
    ids: string[],
  ): Promise<string[]> {
    if (ids.length === 0) return [];
    return withTenant(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select({ id: speakers.id })
        .from(speakers)
        .where(
          and(
            eq(speakers.organizationId, organizationId),
            eq(speakers.eventId, eventId),
            inArray(speakers.id, ids),
            isNull(speakers.deletedAt),
          ),
        );
      return rows.map((r) => r.id);
    });
  }

  /** Speakers per session id (id + name), in link order — for the list response. */
  async speakersFor(
    organizationId: number,
    sessionIds: string[],
  ): Promise<Map<string, SessionSpeakerRef[]>> {
    const grouped = new Map<string, SessionSpeakerRef[]>();
    if (sessionIds.length === 0) return grouped;
    await withTenant(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select({
          sessionId: sessionSpeakers.sessionId,
          id: speakers.id,
          name: speakers.name,
        })
        .from(sessionSpeakers)
        .innerJoin(speakers, eq(speakers.id, sessionSpeakers.speakerId))
        .where(
          and(
            inArray(sessionSpeakers.sessionId, sessionIds),
            isNull(speakers.deletedAt),
          ),
        )
        .orderBy(
          asc(sessionSpeakers.sessionId),
          asc(sessionSpeakers.sortOrder),
        );
      for (const r of rows) {
        const list = grouped.get(r.sessionId) ?? [];
        list.push({ id: r.id, name: r.name });
        grouped.set(r.sessionId, list);
      }
    });
    return grouped;
  }

  private byId(
    organizationId: number,
    eventId: string,
    sessionId: string,
  ): SQL {
    return and(
      eq(sessions.id, sessionId),
      eq(sessions.organizationId, organizationId),
      eq(sessions.eventId, eventId),
      isNull(sessions.deletedAt),
    ) as SQL;
  }
}
