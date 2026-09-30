-- Give the built-in roles the three permission keys added after them.
--
-- A workspace is handed its Admin / Organizer / Staff roles exactly once, by
-- `insertDefaultRoles` on the day it signs up. Three keys have been added to
-- the catalog since — `finManage` (0034), `evProgramView` (0038) and
-- `regManage` (0042) — and nothing ever went back for the workspaces that
-- already existed. So an Admin whose role says "Full access" cannot void an
-- invoice, retry a payout or file a VAT period, and an Organizer cannot approve
-- a registration: not because anybody decided that, but because their workspace
-- is older than the key.
--
-- Per role, and deliberately not "the three keys everywhere": `finManage` is in
-- Admin's defaults alone, so handing it to Organizer or Staff would be an
-- escalation this migration invented. The matrix below is `DEFAULT_ROLES` in
-- `src/modules/access/workspace-defaults.ts`, restricted to those three keys.
--
-- Restricted to those three on purpose. A revoke used to DELETE the row, so a
-- key an organizer took away before today is indistinguishable on disk from one
-- that was never offered. Older keys are therefore left alone — only the keys
-- that no workspace can ever have been offered are filled in. From now on a
-- revoke records `granted = false`, and ON CONFLICT DO NOTHING means such a row
-- is never overwritten: this can only fill a gap, never reverse a decision.
--
-- Only `is_system` roles. A role a workspace created itself is nobody's default,
-- whatever it was named.
--
-- Every tenant, with no organization predicate: migrations are meant to run as
-- the owning role, which RLS does not apply to. Idempotent and safe to re-run.
--
-- That convention is an ops one, though, and this is the first migration whose
-- DML READS an RLS-protected tenant table. Run as the non-owning role the app
-- connects as (0002), `roles` has no `app.current_org` to match, the SELECT
-- finds nothing, and the backfill would insert zero rows, commit, and be
-- stamped as applied — a migration that silently did nothing at all, leaving
-- every organizer still short of the keys below. `row_security = off` is the
-- one setting that says "fail rather than quietly filter": a no-op for the
-- owning role, and an error for any role RLS would apply to. It is reset
-- immediately afterwards because drizzle runs every pending migration inside a
-- single transaction, and this one has no business changing the others.
SET LOCAL row_security = off;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_key", "granted")
SELECT r."id", d."key"::permission_key, true
  FROM "roles" r
  JOIN (VALUES
    ('Admin', 'evProgramView'),
    ('Admin', 'finManage'),
    ('Admin', 'regManage'),
    ('Organizer', 'evProgramView'),
    ('Organizer', 'regManage'),
    ('Staff', 'evProgramView')
  ) AS d("role_name", "key") ON d."role_name" = r."name"
  JOIN "permissions" p ON p."key" = d."key"::permission_key
 WHERE r."is_system"
ON CONFLICT ("role_id", "permission_key") DO NOTHING;--> statement-breakpoint
SET LOCAL row_security = on;
