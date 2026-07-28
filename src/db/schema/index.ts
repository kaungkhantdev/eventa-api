// Drizzle schema barrel — the schema source of truth is
// ../../../eventa-docs/04-architecture/entities.md (47 tables).
//
// Domain tables land here one module at a time (identity, organization, events,
// ticketing, registration, attendance, payments, engagement, meetings, platform).
// `pnpm generate` diffs whatever is exported here into SQL migrations.
//
// Empty for now (foundation only): no domain tables translated yet.
export {};
