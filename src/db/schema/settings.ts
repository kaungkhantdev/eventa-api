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
import { apiKeyStatusEnum, notificationKindEnum } from './enums';
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
