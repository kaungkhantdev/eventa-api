-- Custom SQL migration file, put your code below! --

-- Row-Level Security for the Events & Program context (mirrors 0002_enable_rls).
-- `categories` and `events` are tenant-owned: visible/writable only for the
-- current org (the transaction-local `app.current_org` GUC set by withTenant).
-- `landing_templates` is a GLOBAL seed lookup (no organization_id) — not RLS-scoped.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['categories', 'events']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL '
      'USING (organization_id = current_setting(''app.current_org'', true)::bigint) '
      'WITH CHECK (organization_id = current_setting(''app.current_org'', true)::bigint)',
      t
    );
  END LOOP;
END $$;
