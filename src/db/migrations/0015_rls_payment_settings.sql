-- Custom SQL migration file, put your code below! --

-- Row-Level Security for the workspace payment-settings tables (tenant-owned;
-- mirrors 0002/0004/0006/0008/0010/0012). Both carry organization_id.
ALTER TABLE "payment_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payment_settings" FOR ALL
  USING (organization_id = current_setting('app.current_org', true)::bigint)
  WITH CHECK (organization_id = current_setting('app.current_org', true)::bigint);--> statement-breakpoint

ALTER TABLE "payment_method_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payment_method_settings" FOR ALL
  USING (organization_id = current_setting('app.current_org', true)::bigint)
  WITH CHECK (organization_id = current_setting('app.current_org', true)::bigint);
