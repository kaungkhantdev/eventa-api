// Drizzle schema barrel — the schema source of truth is
// ../../../eventa-docs/04-architecture/entities.md.
//
// Grouped by bounded context; drizzle-kit diffs everything exported here into
// SQL migrations, and the runtime `drizzle(pool, { schema })` picks it up.

export * from './enums';
export * from './organizations';
export * from './identity'; // users, roles, permissions, role_permissions, memberships, auth_sessions, two_factors, recovery_codes
export * from './settings'; // api_keys, notification_preferences
export * from './platform'; // audit_events, outbox_events, webhook_events
export * from './events'; // categories, landing_templates, events
