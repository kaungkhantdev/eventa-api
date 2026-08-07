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
import { citext } from './_types';
import { events } from './events';
import { users } from './identity';
import { organizations } from './organizations';

/**
 * An invitation to one event (US-REG-06). An invite is a promise to attend,
 * not a booking — it reserves no seat until the invitee actually registers,
 * so this table deliberately has no link to orders or tickets.
 *
 * `recipient_email` is `citext` and that is load-bearing: with plain `text`,
 * `Ada@x.com` and `ada@x.com` would be two different invitations and the
 * duplicate email the story forbids would go out anyway.
 */
export const eventInvitations = pgTable(
  'event_invitations',
  {
    id: idPk(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    eventId: uuid()
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    recipientName: text().notNull(),
    recipientEmail: citext().notNull(),
    /** The optional personal note that heads the email. */
    message: text(),
    invitedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    sentAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    // One invite per person per event: the constraint the dedupe hangs on.
    unique('uq_event_invitations_recipient').on(
      t.organizationId,
      t.eventId,
      t.recipientEmail,
    ),
    index('ix_event_invitations_event').on(t.organizationId, t.eventId),
  ],
);
