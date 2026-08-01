import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, idPk, updatedAt, version } from './_columns';
import {
  localeEnum,
  memberStatusEnum,
  permissionGroupEnum,
  permissionKeyEnum,
  twoFactorMethodEnum,
  userPersonaEnum,
} from './enums';
import { bytea, citext, inet } from './_types';
import { organizations } from './organizations';

/**
 * A login identity. Admin-console and portal personas are distinct rows even at
 * the same email (the two realms never share a login — ADR-8).
 */
export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    email: citext().notNull(),
    persona: userPersonaEnum().notNull().default('admin'),
    initials: text(),
    status: memberStatusEnum().notNull().default('Invited'),
    passwordHash: text(), // Argon2id; never returned or logged
    avatarUrl: text(),
    /** Contact number; also gates the SMS notification toggles (US-SET-01/06). */
    phone: text(),
    /** Per-user override of the org timezone; IANA name (US-SET-01). */
    timezone: text(),
    /**
     * A requested new email awaiting confirmation (US-SET-01). The current `email`
     * keeps working for sign-in until the link is opened, then this is promoted.
     */
    pendingEmail: citext(),
    twoFactorEnabled: boolean().notNull().default(false),
    locale: localeEnum(), // per-user override of org locale
    // FK -> attendees(id) added once the attendees table lands (portal persona link).
    attendeeId: bigint({ mode: 'number' }),
    lastActiveAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
    version: version(),
  },
  (t) => [
    unique('uq_users_org_email_persona').on(
      t.organizationId,
      t.email,
      t.persona,
    ),
    index('ix_users_org').on(t.organizationId),
    index('ix_users_email').on(t.email),
  ],
);

/** Named preset of the 12 permissions, per organization. */
export const roles = pgTable(
  'roles',
  {
    id: idPk(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    // TEXT, not the member_role enum: a workspace may add custom roles such as
    // "Volunteer" (US-SET-13). The four built-ins keep their names and are marked
    // isSystem; uq_roles_org_name still guarantees one name per workspace.
    name: text().notNull(),
    description: text().notNull(),
    bullets: jsonb().$type<string[]>(),
    isSystem: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [unique('uq_roles_org_name').on(t.organizationId, t.name)],
);

/** Global fixed lookup of the 12 permission keys. Not tenant-scoped. */
export const permissions = pgTable(
  'permissions',
  {
    key: permissionKeyEnum().primaryKey(),
    group: permissionGroupEnum().notNull(),
    label: text().notNull(),
  },
  (t) => [index('ix_permissions_group').on(t.group)],
);

/** Junction: which permissions each role grants (preset matrix). Not tenant-scoped. */
export const rolePermissions = pgTable(
  'role_permissions',
  {
    id: idPk(),
    roleId: bigint({ mode: 'number' })
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionKey: permissionKeyEnum()
      .notNull()
      .references(() => permissions.key, { onDelete: 'restrict' }),
    granted: boolean().notNull().default(false),
  },
  (t) => [
    unique('uq_role_permissions').on(t.roleId, t.permissionKey),
    index('ix_role_permissions_role').on(t.roleId),
  ],
);

/**
 * Junction: a user's association with an organization and the role they hold.
 * Also models the invite lifecycle (status='Invited', invited_at, joined_at) —
 * there is no separate invitations table.
 */
export const memberships = pgTable(
  'memberships',
  {
    id: idPk(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: bigint({ mode: 'number' })
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    role: text().notNull(), // denormalized role name (may be a custom role)
    status: memberStatusEnum().notNull().default('Invited'),
    invitedAt: timestamp({ withTimezone: true }),
    joinedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
    version: version(),
  },
  (t) => [
    unique('uq_memberships_org_user').on(t.organizationId, t.userId),
    index('ix_memberships_org').on(t.organizationId),
    index('ix_memberships_user').on(t.userId),
    index('ix_memberships_role').on(t.roleId),
  ],
);

/**
 * Active sign-in sessions / devices. Append-mostly (revoke sets a timestamp).
 * The uuid PK IS the opaque session token id; there is no separate refresh_tokens
 * table. Redis is the live session store (ADR-6); this is the durable device list.
 */
export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    device: text().notNull(),
    meta: text(),
    ipAddress: inet(),
    isCurrent: boolean().notNull().default(false),
    createdAt: createdAt(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index('ix_auth_sessions_user').on(t.userId),
    index('ix_auth_sessions_org').on(t.organizationId),
    index('ix_auth_sessions_active')
      .on(t.userId)
      .where(sql`revoked_at is null`),
  ],
);

/** Per-user TOTP enrollment (0..1 per user). */
export const twoFactors = pgTable('two_factors', {
  id: idPk(),
  organizationId: bigint({ mode: 'number' })
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .unique(),
  method: twoFactorMethodEnum().notNull().default('totp'),
  secretEncrypted: bytea().notNull(),
  otpauthUri: text(),
  confirmedAt: timestamp({ withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** One-time 2FA backup codes. Sub-child of two_factors; not tenant-scoped. */
export const recoveryCodes = pgTable(
  'recovery_codes',
  {
    id: idPk(),
    twoFactorId: bigint({ mode: 'number' })
      .notNull()
      .references(() => twoFactors.id, { onDelete: 'cascade' }),
    codeHash: text().notNull(),
    usedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('uq_recovery_codes').on(t.twoFactorId, t.codeHash),
    index('ix_recovery_codes_2fa').on(t.twoFactorId),
  ],
);
