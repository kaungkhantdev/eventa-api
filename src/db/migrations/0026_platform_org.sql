-- Custom SQL migration file, put your code below! --

-- The platform organization that holds every attendee account (US-DISC-08).
-- Attendee sign-in resolves to this workspace by its well-known slug — see
-- src/common/tenancy/platform-org.ts for the reasoning. Idempotent: re-running
-- the migration (or racing another environment's seed) changes nothing.
INSERT INTO organizations (name, slug)
VALUES ('Eventa', 'eventa')
ON CONFLICT (slug) DO NOTHING;
