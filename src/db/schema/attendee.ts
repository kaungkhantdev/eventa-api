import { index, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, idPk } from './_columns';
import { events } from './events';
import { users } from './identity';

/**
 * An event an attendee bookmarked to come back to (US-DISC-03).
 *
 * Deliberately keyed by the PERSON, not the workspace. Every other context here
 * carries `organization_id` and sits under per-org RLS, but the Discover grid
 * these hearts are tapped on is cross-tenant, so the saves it produces are too:
 * one attendee's list can hold events from a dozen different organizers. A
 * tenant column would have to pick one of them, and a per-org policy would then
 * hide most of the list from the person who made it.
 *
 * Isolation is `user_id`, enforced in the app: every query in
 * `SavedEventsRepository` scopes by it, and no route accepts anyone else's. RLS
 * is deliberately NOT enabled here — its isolating column is the user, and there
 * is no per-user GUC in this codebase to write a policy against (`withTenant`
 * sets `app.current_org` only). Adding one is a platform change, not this
 * table's to make.
 *
 * The unique pair is what makes saving idempotent and gives "merged with no
 * duplicates" (guest saves adopted at sign-in) for free.
 */
export const savedEvents = pgTable(
  'saved_events',
  {
    id: idPk(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventId: uuid()
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    savedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('uq_saved_events_user_event').on(t.userId, t.eventId),
    index('ix_saved_events_user').on(t.userId, t.savedAt),
    index('ix_saved_events_event').on(t.eventId),
  ],
);
