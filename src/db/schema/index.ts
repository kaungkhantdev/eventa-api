// Drizzle schema barrel — the schema source of truth is
// ../../../eventa-docs/04-architecture/entities.md.
//
// Grouped by bounded context; drizzle-kit diffs everything exported here into
// SQL migrations, and the runtime `drizzle(pool, { schema })` picks it up.

export * from './enums';
export * from './organizations';
export * from './identity'; // users, roles, permissions, role_permissions, memberships, auth_sessions, two_factors, recovery_codes
export * from './settings'; // api_keys, notification_preferences
export * from './payment-settings'; // payment_settings, payment_method_settings
export * from './platform'; // audit_events, outbox_events, webhook_events
export * from './events'; // categories, landing_templates, events
export * from './ticketing'; // ticket_types
export * from './promotions'; // discount_codes
export * from './program'; // speakers, sessions, session_speakers
export * from './seating'; // seat_maps, seats
export * from './registration'; // attendees, orders, order_items, tickets, seat_assignments, seat_holds
export * from './payments'; // payments, refunds, webhook_events
export * from './checkin'; // check_ins — one admission per ticket (E8)
export * from './invitations'; // event_invitations (E8)
export * from './finance'; // invoices, payouts, payout_items, tax_periods
export * from './attendee'; // saved_events — keyed by user, not by workspace
