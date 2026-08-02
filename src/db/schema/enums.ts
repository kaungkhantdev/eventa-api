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

// ── Program (agenda & speakers) ──────────────────────────────────────────────

export const sessionTypeEnum = pgEnum('session_type', [
  'Keynote',
  'Talk',
  'Workshop',
  'Panel',
  'Break',
]);

export const sessionColorEnum = pgEnum('session_color', [
  'green',
  'amber',
  'rose',
]);

export const speakerToneEnum = pgEnum('speaker_tone', [
  'green',
  'blue',
  'purple',
  'amber',
  'red',
  'pink',
]);

export const seatStatusEnum = pgEnum('seat_status', [
  'available',
  'held',
  'reserved',
  'sold',
  'blocked',
]);

// ── Ticketing ────────────────────────────────────────────────────────────────

export const ticketStatusEnum = pgEnum('ticket_status', [
  'onsale',
  'scheduled',
  'paused',
  'soldout',
]);

export const admissionTypeEnum = pgEnum('admission_type', [
  'general_admission',
  'reserved_seat',
]);

// ── Promotions ───────────────────────────────────────────────────────────────

/** `percent` is 1–100; `fixed` is an amount in satang. */
export const discountTypeEnum = pgEnum('discount_type', ['percent', 'fixed']);

/**
 * A code's sellable state. `scheduled`/`active`/`expired` follow the validity
 * window and usage limit on their own (US-TKT-10); `disabled` is the organizer
 * switching it off by hand (US-TKT-09).
 */
export const discountStatusEnum = pgEnum('discount_status', [
  'active',
  'scheduled',
  'expired',
  'disabled',
]);

// ── Registration, Orders & Payments ──────────────────────────────────────────

export const attendeeTagEnum = pgEnum('attendee_tag', [
  'VIP',
  'Speaker',
  'Sponsor',
  'Student',
]);

export const orderStatusEnum = pgEnum('order_status', [
  'confirmed',
  'pending',
  'waitlisted',
  'cancelled',
]);

export const paymentStatusEnum = pgEnum('payment_status', [
  'paid',
  'pending',
  'refunded',
  'failed',
]);

export const issuedTicketStatusEnum = pgEnum('issued_ticket_status', [
  'issued',
  'checked_in',
  'void',
  'refunded',
  'transferred',
]);

export const paymentMethodEnum = pgEnum('payment_method', [
  'Card',
  'PromptPay',
  'Bank transfer',
  // Wallets (US-SET-09) — appended; enum values are add-only.
  'Apple Pay',
  'Google Pay',
]);

/** Identity providers a member may sign in with (US-ACC-06). */
export const socialProviderEnum = pgEnum('social_provider', [
  'google',
  'apple',
  'linkedin',
]);

/** Which payment provider a workspace is connected to (US-SET-08). */
export const paymentProviderEnum = pgEnum('payment_provider', ['stripe']);

/** Test mode takes no real money; live does (US-SET-08). */
export const paymentModeEnum = pgEnum('payment_mode', ['test', 'live']);

/** Connection state of a workspace's payment account (US-SET-08). */
export const paymentConnectionStatusEnum = pgEnum('payment_connection_status', [
  'disconnected',
  'connected',
]);

export const refundStatusEnum = pgEnum('refund_status', [
  'pending',
  'succeeded',
  'failed',
]);

export const holdStatusEnum = pgEnum('hold_status', [
  'active',
  'converted',
  'expired',
  'released',
]);
