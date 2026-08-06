-- Tenant isolation for message_templates (US-MSG-01/02). Same policy shape as
-- every other tenant table: an unscoped connection sees nothing, because
-- current_setting(..., true) is NULL and `NULL = anything` is never true.
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON message_templates FOR ALL
  USING (organization_id = current_setting('app.current_org', true)::bigint)
  WITH CHECK (organization_id = current_setting('app.current_org', true)::bigint);
