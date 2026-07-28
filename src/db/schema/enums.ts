import { pgEnum } from 'drizzle-orm/pg-core';

// Postgres enum types. Values are verbatim from entities.md — do not reorder or
// rename (enum value order is part of the on-disk type).

export const localeEnum = pgEnum('locale', ['en', 'th']);

export const userPersonaEnum = pgEnum('user_persona', ['admin', 'attendee']);

export const memberStatusEnum = pgEnum('member_status', [
  'Active',
  'Invited',
  'Suspended',
]);

export const memberRoleEnum = pgEnum('member_role', [
  'Admin',
  'Organizer',
  'Staff',
  'Attendee',
]);

export const permissionKeyEnum = pgEnum('permission_key', [
  'evCreate',
  'evPublish',
  'evSpeakers',
  'regView',
  'regCheckin',
  'regExport',
  'finView',
  'finRefund',
  'finDiscount',
  'setUsers',
  'setSettings',
  'setIntegrations',
]);

export const permissionGroupEnum = pgEnum('permission_group', [
  'Events',
  'Registrations',
  'Finance',
  'Settings',
]);

export const twoFactorMethodEnum = pgEnum('two_factor_method', ['totp']);

export const apiKeyStatusEnum = pgEnum('api_key_status', ['active', 'revoked']);

export const notificationKindEnum = pgEnum('notification_kind', [
  'registration',
  'payment',
  'sales',
  'feedback',
  'payout',
  'alert',
  'task',
]);

export const auditTypeEnum = pgEnum('audit_type', [
  'signin',
  'newdev',
  'pwd',
  'twofa',
  'perm',
  'xport',
  'fail',
  'apikey',
  'revoke',
]);

export const webhookStatusEnum = pgEnum('webhook_status', [
  'received',
  'processed',
  'failed',
]);

// ── Events & Program ─────────────────────────────────────────────────────────

export const eventStatusEnum = pgEnum('event_status', [
  'draft',
  'planned',
  'upcoming',
  'live',
  'completed',
  'cancelled',
]);

export const eventTypeEnum = pgEnum('event_type', [
  'Conference',
  'Networking',
  'Workshop',
  'Charity & Gala',
  'Sports & Wellness',
  'Concert & Festival',
  'Exhibition',
  'Seminar',
]);

export const eventBucketEnum = pgEnum('event_bucket', ['active', 'completed']);

export const visibilityEnum = pgEnum('visibility', [
  'private',
  'unlisted',
  'public',
]);

export const seatingModeEnum = pgEnum('seating_mode', ['reserved', 'ga']);

export const categoryColorEnum = pgEnum('category_color', [
  'pink',
  'blue',
  'amber',
  'brand',
  'violet',
  'indigo',
  'teal',
  'red',
]);

export const templateIdEnum = pgEnum('template_id', [
  'aurora',
  'noir',
  'minimal',
  'atlas',
]);
