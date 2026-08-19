import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  time,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, idPk, updatedAt, version } from './_columns';
import { citext } from './_types';
import { sessionColorEnum, sessionTypeEnum, speakerToneEnum } from './enums';
import { events } from './events';
import { organizations } from './organizations';

/** A speaker featured at an event (SRS `Speaker`). */
export const speakers = pgTable(
  'speakers',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    eventId: uuid()
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    role: text(),
    email: citext(),
    phone: text(),
    talkTitle: text(),
    tag: text(),
    initials: text(),
    tone: speakerToneEnum(),
    rating: numeric({ precision: 3, scale: 2 }),
    /** The profile an organizer keeps current (US-PROG-09/10). */
    bio: text(),
    photoUrl: text(),
    website: text(),
    /** `{ twitter, linkedin, … }` — links only; validated as URLs at the edge. */
    socialLinks: jsonb().$type<Record<string, string>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
    version: version(),
  },
  (t) => [
    index('ix_speakers_event').on(t.eventId),
    index('ix_speakers_org').on(t.organizationId),
    /**
     * One live speaker per email per event (US-PROG-09/10). Partial, so the
     * many speakers with no email on file don't collide, and soft-deleted rows
     * free their email for re-use.
     */
    uniqueIndex('uq_speakers_event_email')
      .on(t.eventId, t.email)
      .where(sql`${t.email} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    index('ix_speakers_name').on(t.eventId, t.name),
  ],
);

/** An agenda/program session (SRS `AgendaSession`). Days are derived from `day`. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    eventId: uuid()
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    day: smallint().notNull(),
    startTime: time().notNull(),
    endTime: time(),
    title: text().notNull(),
    type: sessionTypeEnum().notNull(),
    room: text(),
    /**
     * Retained so historic rows keep their value, but no longer written or
     * read: the response colour is derived from `type` (US-PROG-01). Expand
     * now, contract in a later migration once eventa-web has stopped sending
     * it.
     */
    color: sessionColorEnum(),
    /** The optional blurb attendees read on the agenda (US-PROG-02). */
    description: text(),
    sortOrder: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
    version: version(),
  },
  (t) => [
    index('ix_sessions_event_day').on(t.eventId, t.day),
    index('ix_sessions_org').on(t.organizationId),
    check(
      'ck_sessions_time',
      sql`${t.endTime} IS NULL OR ${t.endTime} > ${t.startTime}`,
    ),
  ],
);

/** M:N junction between sessions and speakers (`AgendaSession.who`). */
export const sessionSpeakers = pgTable(
  'session_speakers',
  {
    id: idPk(),
    sessionId: uuid()
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    speakerId: uuid()
      .notNull()
      .references(() => speakers.id, { onDelete: 'cascade' }),
    sortOrder: integer().notNull().default(0),
  },
  (t) => [
    unique('uq_session_speakers').on(t.sessionId, t.speakerId),
    index('ix_session_speakers_session').on(t.sessionId),
    index('ix_session_speakers_speaker').on(t.speakerId),
  ],
);
