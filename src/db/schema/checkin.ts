import {
  bigint,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idPk } from './_columns';
import { checkInMethodEnum, scanOutcomeEnum } from './enums';
import { events } from './events';
import { users } from './identity';
import { organizations } from './organizations';
import { attendees, tickets } from './registration';

/**
 * One admission through the door (US-REG-11/12/13).
 *
 * `uq_check_ins_ticket` — a unique on `ticket_id` ALONE — is the whole
 * correctness story. Two staff scanning the same code at the same instant both
 * try to insert; exactly one wins and the loser reads back the winner's row, so
 * the second scan reports "already checked in" with the ORIGINAL arrival time
 * instead of admitting a second person or overwriting the first time. It is a
 * database guarantee rather than a read-then-write check, which under
 * concurrency is no guarantee at all.
 *
 * Undo (US-REG-11) DELETEs the row rather than flagging it: an admission that
 * was reversed did not happen, and keeping a tombstone would force every count,
 * every progress bar and the unique constraint itself to reason about it. The
 * reversal is recorded in `audit_events`, which is where "who undid what" is
 * asked from.
 *
 * `tickets.checked_in_at` / `tickets.status` are mirrored in the SAME
 * transaction so the attendee's own ticket view stays truthful; this table is
 * the source of truth, that pair is the projection.
 *
 * The admit MUST be a single statement, or the constraint buys nothing:
 *
 * ```sql
 * INSERT INTO check_ins (...) VALUES (...)
 * ON CONFLICT ON CONSTRAINT uq_check_ins_ticket DO UPDATE
 *   SET checked_in_at = LEAST(check_ins.checked_in_at, EXCLUDED.checked_in_at)
 * RETURNING id, checked_in_at, (xmax = 0) AS inserted;
 * ```
 *
 * `DO UPDATE` rather than `DO NOTHING` so `RETURNING` always yields a row — a
 * conflicting `DO NOTHING` returns nothing and would force a second read, which
 * is the race this constraint exists to close. `LEAST` keeps the EARLIEST
 * arrival, which is what the story asks for and what makes an out-of-order
 * offline replay harmless. `xmax = 0` is how the caller learns whether it
 * admitted someone or found them already inside.
 */
export const checkIns = pgTable(
  'check_ins',
  {
    id: idPk(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /**
     * RESTRICT, not cascade: who came through the door is history, and it must
     * outlive the event row rather than being erased with it.
     */
    eventId: uuid()
      .notNull()
      .references(() => events.id, { onDelete: 'restrict' }),
    ticketId: uuid()
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    attendeeId: bigint({ mode: 'number' }).references(() => attendees.id, {
      onDelete: 'set null',
    }),
    checkedInAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    method: checkInMethodEnum().notNull(),
    /** The staff member who admitted them; null if the account is later removed. */
    checkedInBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    /** Which door station read the code — for reconciling a busy entrance. */
    stationId: text(),
    createdAt: createdAt(),
  },
  (t) => [
    // Exactly one live admission per ticket. See the docstring.
    unique('uq_check_ins_ticket').on(t.ticketId),
    index('ix_check_ins_event').on(t.organizationId, t.eventId),
    // The "just checked in" feed reads newest-first per event.
    index('ix_check_ins_feed').on(t.eventId, t.checkedInAt),
    index('ix_check_ins_attendee').on(t.attendeeId),
  ],
);

/**
 * Every scan the door made, and what it decided (US-REG-12).
 *
 * 0039 created the `scan_outcome` enum and gave it no column, so until 0068 a
 * bad QR, a pass for another event or a refunded ticket turned away at the door
 * left no trace at all — no count, nothing to settle a disputed entry with, and
 * no way to tell a quiet night from a scanner that had stopped working.
 * erd.md's "Designed but not built" calls the orphan enum the clearest evidence
 * the door was built halfway. This is its column.
 *
 * It could NOT be a column on `check_ins`, which is what the ERD drew
 * (`check_ins.state`, `.other_event_id`, `.scanned_qr`). `uq_check_ins_ticket`
 * is a UNIQUE on `ticket_id` alone and it is the whole concurrency story above;
 * a refusal is not one row per ticket — the same damaged pass is presented five
 * times in a minute, and an unknown code has no ticket at all, so `ticket_id`
 * could not even stay `NOT NULL`. Recording refusals there would have had to
 * weaken the one constraint protecting the admission.
 *
 * It records ADMISSIONS too, `already_checked_in` included. A table of
 * refusals alone has no denominator: "19 invalid scans" is unreadable without
 * the 1,340 that worked, and the refusal RATE is what tells a busy door from a
 * broken one. `CheckInRepository.admit` writes the `check_ins` row and this one
 * in the SAME transaction, so neither can exist without the other.
 *
 * APPEND-ONLY, which is what makes it evidence rather than state. Undo DELETEs
 * the `check_ins` row — a reversed admission did not happen — while the
 * `admitted` row here survives, because the scan did happen. `check_ins` is the
 * state of the room; this is the history of the door. An undo writes nothing
 * here: it is not a scan, `audit_events` already answers "who undid what", and
 * a synthetic row would make the outcome counts lie. Nothing updates or deletes
 * these rows, which is a property of the only writer rather than something the
 * schema enforces — the app connects as the schema owner, so a REVOKE would not
 * bind it, exactly as RLS does not.
 */
export const scanAttempts = pgTable(
  'scan_attempts',
  {
    id: idPk(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /**
     * The event the STATION was bound to. RESTRICT, matching `check_ins`: what
     * happened at a door is history and must outlive the event row.
     */
    eventId: uuid()
      .notNull()
      .references(() => events.id, { onDelete: 'restrict' }),
    outcome: scanOutcomeEnum().notNull(),
    method: checkInMethodEnum().notNull(),
    /**
     * Null for an unrecognised code — the commonest refusal, and one with no
     * ticket to point at. SET NULL on delete rather than CASCADE, which would
     * let erasing a ticket erase the evidence that it was refused, or RESTRICT,
     * which would block the hard deletes account erasure performs. The outcome,
     * the time, the station and the fingerprint survive either way.
     */
    ticketId: uuid().references(() => tickets.id, { onDelete: 'set null' }),
    /**
     * Which event the presented pass actually belonged to — the ERD's
     * `other_event_id`, and the single thing a `wrong_event` refusal is about.
     * Written ONLY when it differs from `eventId`, so `IS NOT NULL` reads as "a
     * pass for somewhere else turned up here" instead of also matching rows
     * where it would merely repeat the event we already know.
     */
    ticketEventId: uuid().references(() => events.id, { onDelete: 'set null' }),
    /**
     * A SHA-256 digest of the code presented — never the code. See
     * `check-in/scan-token-fingerprint.ts` for the full reasoning: a QR token
     * is a bearer credential, and this table is append-only, outlives the
     * ticket and is read by everyone who may review a door, so raw tokens in it
     * would make the log a list of working passes. Null means no code was
     * presented, which is precisely what a manual admission is.
     */
    tokenFingerprint: text(),
    /** Which door read it, for reconciling a busy entrance. */
    stationId: text(),
    /** The staff member who scanned; null once that account is removed. */
    scannedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    /**
     * When the scan happened, which an offline replay may backdate — as
     * against `createdAt`, when the row reached us.
     */
    scannedAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    // The door-incident report reads one event's night newest-first. Counts per
    // outcome are filtered off this same index rather than getting one of their
    // own: a night is a few thousand rows, so a second index would be paid on
    // every scan to save a filter over a set that small.
    index('ix_scan_attempts_event').on(
      t.organizationId,
      t.eventId,
      t.scannedAt,
    ),
    // "One broken pass, or forty different bad codes?" — the question the
    // fingerprint exists to answer, which is a GROUP BY over this.
    index('ix_scan_attempts_token').on(t.organizationId, t.tokenFingerprint),
    // Settling one disputed entry: every scan this ticket was ever part of.
    index('ix_scan_attempts_ticket').on(t.ticketId),
  ],
);
