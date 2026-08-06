-- Tenant isolation for the finance tables (E9). Same policy shape as every
-- other tenant table: an unscoped connection sees nothing, because
-- current_setting(..., true) is NULL and `NULL = anything` is never true.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['invoices', 'payouts', 'payout_items', 'tax_periods']
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
