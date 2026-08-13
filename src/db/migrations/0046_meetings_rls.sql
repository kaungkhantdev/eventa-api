-- Tenant isolation for meetings, matching every other tenant table.
-- Defence in depth: the app connects as the schema owner and still scopes every
-- query by organization_id, so this is the second line, not the only one.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['meetings']
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
