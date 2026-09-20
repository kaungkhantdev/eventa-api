import {
  bigint,
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idPk, updatedAt } from './_columns';
import {
  apiKeyStatusEnum,
  deliveryStatusEnum,
  messageChannelEnum,
  notificationKindEnum,
} from './enums';
import { organizations } from './organizations';
import { users } from './identity';

/** Integration/API credentials. The full key is shown once; only a hash is stored. */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: idPk(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    keyPrefix: text().notNull().unique(),
    keyHash: text().notNull(),
    status: apiKeyStatusEnum().notNull().default('active'),
    createdBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    lastUsedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('ix_api_keys_org').on(t.organizationId)],
);

/** Per-user email/SMS toggle per notification category; gates message delivery. */
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: idPk(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: notificationKindEnum().notNull(),
    title: text(),
    description: text(),
    emailEnabled: boolean().notNull().default(true),
    smsEnabled: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('uq_notif_prefs_user_category').on(t.userId, t.category),
    index('ix_notif_prefs_user').on(t.userId),
  ],
);

/**
 * How far one member has read their notification feed (US-MSG-03).
 *
 * A watermark, not a row per notification. The feed itself is DERIVED from
 * registrations, payments and payouts as they already stand, so there is nothing
 * to mark read one by one — "unread" means "happened after this instant", and
 * the whole of "mark all read" is moving this timestamp forward.
 *
 * One row per (organization, member): a colleague clearing their own feed must
 * not clear anybody else's.
 */
export const notificationReads = pgTable(
  'notification_reads',
  {
    id: idPk(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Everything at or before this instant is read. */
    readAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('uq_notification_reads_member').on(t.organizationId, t.userId),
  ],
);

/**
 * One automated message an organizer controls (US-MSG-01/02): the
 * registration confirmation, the payment receipt, the reminder, and so on,
 * identified by a stable `slug`.
 *
 * Only `active` is honoured today — it is the kill switch the trigger checks
 * before sending, and an ABSENT row means active, so a workspace that has
 * never touched its settings still gets its confirmations. The wording columns
 * exist because `entities.md` specifies them and US-MSG-02 will edit them; the
 * worker renders built-in EN/TH copy until then.
 *
 * Scope is (organization, slug) — per workspace, per message kind. There is
 * deliberately no `event_id`: neither the story nor the data model gives an
 * organizer per-event control of an automated message.
 */
export const messageTemplates = pgTable(
  'message_templates',
  {
    id: idPk(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Stable identifier, e.g. `registration-confirmation`. */
    slug: text().notNull(),
    title: text().notNull(),
    description: text(),
    /** Which channels this message may use; email-only for now. */
    channels: messageChannelEnum().array().notNull().default(['email']),
    /** The kill switch US-MSG-01 checks. */
    active: boolean().notNull().default(true),
    /** Merge tags the editor may offer (US-MSG-02). */
    tags: text().array().notNull().default([]),
    emailSubjectEn: text(),
    emailSubjectTh: text(),
    emailBodyEn: text(),
    emailBodyTh: text(),
    smsBodyEn: text(),
    smsBodyTh: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('uq_message_templates_org_slug').on(t.organizationId, t.slug),
    index('ix_message_templates_org').on(t.organizationId),
  ],
);

/**
 * One broadcast an organizer sent to an event's attendees (US-MSG-04).
 *
 * A RECORD of a send, not a queue. The sending is already done by the outbox
 * event written in the same transaction — this row exists so the organizer can
 * see what they have sent, which is the one thing the broadcast path could not
 * answer. Row and outbox event live or die together: an announcement listed but
 * never sent, and one sent but never listed, are both wrong.
 *
 * `recipientCount` is the attendee count AT THE MOMENT IT WAS QUEUED. eventa-worker
 * resolves the real recipients when it sends, so this is what the organizer was
 * told they were writing to, not a delivery receipt. Proving delivery is
 * US-MSG-06 and needs a per-recipient table this one deliberately is not.
 *
 * There is no schedule column and no audience column. Nothing in the product
 * can send later, and the broadcast path takes one event's confirmed attendees
 * — a column for either would be a promise the send path cannot keep.
 */
export const announcements = pgTable(
  'announcements',
  {
    id: idPk(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** The event whose attendees were written to. */
    eventId: uuid().notNull(),
    subject: text().notNull(),
    body: text().notNull(),
    /** How many attendees it was queued for — see the note above. */
    recipientCount: bigint({ mode: 'number' }).notNull(),
    /** Who sent it. Kept when they leave: the send still happened. */
    sentByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    sentAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('ix_announcements_org_sent').on(t.organizationId, t.sentAt),
    index('ix_announcements_event').on(t.organizationId, t.eventId),
  ],
);

/**
 * One outbound message and what became of it (US-MSG-06).
 *
 * Written by eventa-worker as it sends, one row per RECIPIENT — a broadcast to
 * 1,340 attendees is 1,340 rows, which is the point: "prove it was sent and
 * diagnose the failures" is a question about individuals, and a per-message
 * summary cannot answer which address bounced.
 *
 * `status` is what the transport said, and nothing more. There is no
 * `delivered` and no `opened`: those need a provider webhook and a tracking
 * pixel, and this product has neither.
 *
 * `kind` is the catalog slug for an automated message (`registration-
 * confirmation`) or `announcement` for a broadcast. Deliberately free text
 * rather than an enum — the worker is the one that knows what it just sent,
 * and a new message type should not need a migration in another repo before it
 * can be logged.
 */
export const messageDeliveries = pgTable(
  'message_deliveries',
  {
    id: idPk(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** The event it was about, where there is one. */
    eventId: uuid(),
    kind: text().notNull(),
    channel: messageChannelEnum().notNull().default('email'),
    recipientEmail: text().notNull(),
    /** Null where the send had only an address to go on. */
    recipientName: text(),
    status: deliveryStatusEnum().notNull(),
    /** Why it failed, for diagnosing. Null on a successful send. */
    error: text(),
    sentAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('ix_message_deliveries_org_sent').on(t.organizationId, t.sentAt),
    index('ix_message_deliveries_org_status').on(t.organizationId, t.status),
  ],
);
