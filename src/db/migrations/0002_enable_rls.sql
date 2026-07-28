-- Custom SQL migration file, put your code below! --

-- Row-Level Security: enforce tenant isolation at the data layer (ADR-5, SAD §9,
-- Principle 6). Each request sets a transaction-local GUC:
--   SELECT set_config('app.current_org', '<organization_id>', true)   -- = SET LOCAL
-- and every org-scoped table filters on it automatically. current_setting(..., true)
-- returns NULL when unset, so an un-scoped connection sees nothing (default deny).
--
-- NOTE: RLS is bypassed for superusers and table owners. The application must
-- connect as a NON-superuser, non-owning role (e.g. eventa_app) in staging/prod for
-- these policies to take effect; migrations run as the owning role. See the RLS
-- isolation test, which proves enforcement under such a role via SET ROLE.

-- Standard tenant tables: visible/writable only for the current org.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'roles', 'memberships', 'auth_sessions', 'two_factors',
    'api_keys', 'notification_preferences', 'audit_events', 'outbox_events'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL '
      'USING (organization_id = current_setting(''app.current_org'', true)::bigint) '
      'WITH CHECK (organization_id = current_setting(''app.current_org'', true)::bigint)',
      t
    );
  END LOOP;
END $$;--> statement-breakpoint

-- organizations: the tenant root. You may read/modify only your own org, but
-- creating a new workspace is allowed (id is unknown before insert).
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_select" ON "organizations" FOR SELECT
  USING (id = current_setting('app.current_org', true)::bigint);--> statement-breakpoint
CREATE POLICY "org_update" ON "organizations" FOR UPDATE
  USING (id = current_setting('app.current_org', true)::bigint)
  WITH CHECK (id = current_setting('app.current_org', true)::bigint);--> statement-breakpoint
CREATE POLICY "org_delete" ON "organizations" FOR DELETE
  USING (id = current_setting('app.current_org', true)::bigint);--> statement-breakpoint
CREATE POLICY "org_insert" ON "organizations" FOR INSERT
  WITH CHECK (true);--> statement-breakpoint

-- webhook_events: organization_id is nullable (tenant resolved lazily), so allow
-- both un-tenanted rows and current-org rows.
ALTER TABLE "webhook_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "webhook_events" FOR ALL
  USING (organization_id IS NULL OR organization_id = current_setting('app.current_org', true)::bigint)
  WITH CHECK (organization_id IS NULL OR organization_id = current_setting('app.current_org', true)::bigint);