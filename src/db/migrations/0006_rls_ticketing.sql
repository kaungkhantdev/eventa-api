-- Custom SQL migration file, put your code below! --

-- Row-Level Security for ticket_types (tenant-owned; mirrors 0002/0004).
ALTER TABLE "ticket_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ticket_types" FOR ALL
  USING (organization_id = current_setting('app.current_org', true)::bigint)
  WITH CHECK (organization_id = current_setting('app.current_org', true)::bigint);
