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
