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
import { checkInMethodEnum } from './enums';
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
