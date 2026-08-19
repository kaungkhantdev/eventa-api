-- Custom SQL migration file, put your code below! --

-- Row-Level Security for the Seating tables (tenant-owned; mirrors 0002/0004/0006/0008).
ALTER TABLE "seat_maps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "seat_maps" FOR ALL
  USING (organization_id = current_setting('app.current_org', true)::bigint)
  WITH CHECK (organization_id = current_setting('app.current_org', true)::bigint);--> statement-breakpoint

ALTER TABLE "seats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "seats" FOR ALL
  USING (organization_id = current_setting('app.current_org', true)::bigint)
  WITH CHECK (organization_id = current_setting('app.current_org', true)::bigint);
