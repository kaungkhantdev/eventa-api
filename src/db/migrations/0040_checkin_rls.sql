-- Tenant isolation for the check-in ledger, matching every other tenant table.
-- Defence in depth: the repository also scopes by organization_id, because the
-- app connects as the schema owner and Postgres skips RLS for that role.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['check_ins']
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
