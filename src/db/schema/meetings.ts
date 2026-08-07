import {
  bigint,
  check,
  date,
  index,
  pgTable,
  text,
  time,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, deletedAt, updatedAt, version } from './_columns';
import { citext } from './_types';
import {
  meetingModeEnum,
  meetingStatusEnum,
  meetingSyncStatusEnum,
  meetingTypeEnum,
} from './enums';
import { events } from './events';
import { users } from './identity';
import { organizations } from './organizations';

/**
 * A coordination meeting an organizer books from the console (E12) — a venue
 * walkthrough, a sponsor call, a speaker briefing.
 *
 * **Times are Bangkok wall clock, not instants.** `meeting_date` + `start_time`
 * are what the organizer typed and what the venue expects; the UTC instant is
 * derived when one is needed (`meeting-bucket.ts`). This mirrors `sessions`,
 * and is why there is no `timestamptz` here.
 *
 * **There is no `bucket` column.** The catalogue lists one as "derived", but a
 * stored today/upcoming/past is wrong from the moment the Bangkok day turns and
 * would need a nightly job to stay true. It is computed per request instead —
 * the same call taken for invoice ageing and session colour.
 *
 * **The calendar is not in the write path.** Saving a meeting never waits on
 * Google: the row commits with `sync_status = 'pending'` and an outbox event in
 * the SAME transaction, and the worker does the invite, the Meet link and the
 * reminder. That is what makes US-MTG-04's "the meeting is still kept" true by
 * construction rather than by a catch block — a calendar outage cannot lose a
 * booking, because the booking was never conditional on it.
 */
export const meetings = pgTable(
  'meetings',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    /** Bangkok calendar day. */
    meetingDate: date().notNull(),
    /** Bangkok wall clock; `end_time > start_time` is enforced below. */
    startTime: time().notNull(),
    endTime: time().notNull(),
    type: meetingTypeEnum().notNull(),
    mode: meetingModeEnum().notNull(),
    status: meetingStatusEnum().notNull().default('scheduled'),
    /** The counterparty: who it is with, what they do, how to invite them. */
    person: text().notNull(),
    role: text(),
    guestEmail: citext().notNull(),
    /**
     * SET NULL, not cascade: a meeting held about an event is still a record of
     * a conversation that happened after the event is gone. Null means the
     * meeting is general (all events), which the story allows explicitly.
     */
    eventId: uuid().references(() => events.id, { onDelete: 'set null' }),
    /** The Meet link, once the calendar sync has produced one (US-MTG-04). */
    link: text(),
    /** The venue for In person, "Phone call" for Phone, null for Video. */
    location: text(),
    notes: text(),
    /** Why it was called off, shown to the guest (US-MTG-06). */
    cancellationReason: text(),
    cancelledAt: deletedAt(),
    syncStatus: meetingSyncStatusEnum().notNull().default('pending'),
    /**
     * The calendar's own id for this meeting. Held so a reschedule UPDATES the
     * guest's existing invite rather than sending a second one (US-MTG-05).
     */
    externalEventId: text(),
    syncError: text(),
    /**
     * The organizer's key for this booking. Unique per workspace, so a
     * double-submitted panel resolves to the one meeting it meant to create
     * rather than booking the guest twice (US-MTG-03).
     */
    idempotencyKey: text(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
    version: version(),
  },
  (t) => [
    unique('uq_meetings_org_idem').on(t.organizationId, t.idempotencyKey),
    index('ix_meetings_event').on(t.eventId),
    /** Backs every list: the tabs, the ordering and the date filters. */
    index('ix_meetings_date').on(t.organizationId, t.meetingDate, t.startTime),
    index('ix_meetings_sync').on(t.organizationId, t.syncStatus),
    check('ck_meetings_times', sql`${t.endTime} > ${t.startTime}`),
  ],
);
