import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  time,
  unique,
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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
    version: version(),
  },
  (t) => [
    index('ix_speakers_event').on(t.eventId),
    index('ix_speakers_org').on(t.organizationId),
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
    color: sessionColorEnum(),
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
