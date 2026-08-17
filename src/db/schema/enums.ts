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
  // Read-only agenda + speaker directory (US-PROG-01/08 notes): Staff support
  // attendees on-site without being able to change the programme. Appended —
  // enum values are add-only.
  'evProgramView',
  'regView',
  'regCheckin',
  'regExport',
  /**
   * Decide, hand-add and invite registrations (US-REG-02/03/06). Separate from
   * `regCheckin` on purpose: Staff work the door but must not approve, reject
   * or create registrations. Appended — enum values are add-only.
   */
  'regManage',
  'finView',
  'finRefund',
  'finDiscount',
  // Admin-tier finance control (US-FIN-14): void an invoice, move payout money,
  // record a VAT filing. Appended — enum values are add-only.
  'finManage',
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

/** How an automated message reaches its recipient (E7). */
export const messageChannelEnum = pgEnum('message_channel', ['email', 'sms']);

export const notificationKindEnum = pgEnum('notification_kind', [
  'registration',
  'payment',
  'sales',
  'feedback',
  'payout',
  'alert',
  'task',
  // Attendee topics (US-DISC-12) — appended; enum values are add-only.
  'reminder',
  'marketing',
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
  // Finance (E9) — appended; enum values are add-only.
  'invoice',
  'payout',
  // Check-in (E8): a manual admit and an undo are both auditable acts.
  'checkin',
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

/**
 * The agenda block palette. One value per `session_type`, because US-PROG-01
 * asks for a type shown by a CONSISTENT colour — the mapping lives in
 * `sessions.mapper.ts`, not in the caller's hands. `blue` and `slate` were
 * appended (enum values are add-only) so all five types can be expressed.
 */
export const sessionColorEnum = pgEnum('session_color', [
  'green',
  'amber',
  'rose',
  'blue',
  'slate',
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
  /**
   * Turned down by an organizer (US-REG-02) — deliberately distinct from
   * `cancelled`, which is the buyer's own withdrawal or a refund. A rejected
   * registration can never be re-approved; the two must not be conflated.
   */
  'rejected',
  /**
   * The seat hold lapsed before the money arrived — nobody ever paid and the
   * clock ran out. Distinct from `cancelled` (a decision somebody made) for the
   * same reason `rejected` is: they read alike in a list and mean opposite
   * things to whoever reconciles it.
   */
  'expired',
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

// ── Check-in (E8) ─────────────────────────────────────────────────────────

/** How an attendee got through the door (US-REG-11/12/13). */
export const checkInMethodEnum = pgEnum('check_in_method', [
  'qr',
  'manual',
  /** Decoded from an uploaded photo when the camera could not be used. */
  'upload',
]);

/** Why a scan was refused — the door needs to say which, not just "no". */
export const scanOutcomeEnum = pgEnum('scan_outcome', [
  'admitted',
  'already_checked_in',
  'invalid',
  'wrong_event',
  'cancelled',
]);

// ── Finance (E9) ──────────────────────────────────────────────────────────
export const invoiceStatusEnum = pgEnum('invoice_status', [
  'issued',
  'paid',
  'overdue',
  'void',
]);

export const payoutStatusEnum = pgEnum('payout_status', [
  'scheduled',
  'processing',
  'paid',
  'failed',
]);

export const taxStatusEnum = pgEnum('tax_status', ['upcoming', 'due', 'filed']);

// ── Meetings (E12) ────────────────────────────────────────────────────────
export const meetingTypeEnum = pgEnum('meeting_type', [
  'Venue',
  'Sponsor',
  'Vendor',
  'Speaker',
  'Internal',
]);

export const meetingModeEnum = pgEnum('meeting_mode', [
  'Video',
  'In person',
  'Phone',
]);

/**
 * Cancelled is terminal and kept on record (US-MTG-06) — a cancelled meeting
 * still shows in Past, it is not erased. There is deliberately no `completed`:
 * whether a meeting has happened is derived from its date, not stored.
 */
export const meetingStatusEnum = pgEnum('meeting_status', [
  'scheduled',
  'cancelled',
]);

/**
 * How far the workspace calendar has got with this meeting (US-MTG-04). The
 * meeting is ALWAYS saved first; this records whether the invite and Meet link
 * made it out, so a calendar outage never loses a booking and can be retried.
 */
export const meetingSyncStatusEnum = pgEnum('meeting_sync_status', [
  'pending',
  'synced',
  'failed',
  /** No calendar is connected, so there is nothing to sync to yet. */
  'not_connected',
]);
