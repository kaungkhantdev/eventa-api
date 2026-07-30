-- Custom SQL migration file, put your code below! --

-- Row-Level Security for the Registration/Orders/Payments tables (tenant-owned;
-- mirrors 0002/0004/0006/0008/0010). Every table carries organization_id.
ALTER TABLE "attendees" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "attendees" FOR ALL
  USING (organization_id = current_setting('app.current_org', true)::bigint)
  WITH CHECK (organization_id = current_setting('app.current_org', true)::bigint);--> statement-breakpoint

ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "orders" FOR ALL
  USING (organization_id = current_setting('app.current_org', true)::bigint)
  WITH CHECK (organization_id = current_setting('app.current_org', true)::bigint);--> statement-breakpoint

ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "order_items" FOR ALL
  USING (organization_id = current_setting('app.current_org', true)::bigint)
  WITH CHECK (organization_id = current_setting('app.current_org', true)::bigint);--> statement-breakpoint

ALTER TABLE "tickets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tickets" FOR ALL
  USING (organization_id = current_setting('app.current_org', true)::bigint)
  WITH CHECK (organization_id = current_setting('app.current_org', true)::bigint);--> statement-breakpoint

ALTER TABLE "seat_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "seat_assignments" FOR ALL
  USING (organization_id = current_setting('app.current_org', true)::bigint)
  WITH CHECK (organization_id = current_setting('app.current_org', true)::bigint);--> statement-breakpoint

ALTER TABLE "seat_holds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "seat_holds" FOR ALL
  USING (organization_id = current_setting('app.current_org', true)::bigint)
  WITH CHECK (organization_id = current_setting('app.current_org', true)::bigint);--> statement-breakpoint

ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payments" FOR ALL
  USING (organization_id = current_setting('app.current_org', true)::bigint)
  WITH CHECK (organization_id = current_setting('app.current_org', true)::bigint);--> statement-breakpoint

ALTER TABLE "refunds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "refunds" FOR ALL
  USING (organization_id = current_setting('app.current_org', true)::bigint)
  WITH CHECK (organization_id = current_setting('app.current_org', true)::bigint);
