-- Custom SQL migration file, put your code below! --

-- Row-Level Security for the promotions tables (tenant-owned; mirrors
-- 0002/0004/…/0020). Both carry organization_id.
--
-- NOTE: an attendee redeeming a code at checkout reaches these through the
-- organizer's tenant context (the order's own organization_id) — a code from one
-- workspace can never be seen, matched or redeemed from another.
ALTER TABLE "discount_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "discount_codes" FOR ALL
  USING (organization_id = current_setting('app.current_org', true)::bigint)
  WITH CHECK (organization_id = current_setting('app.current_org', true)::bigint);--> statement-breakpoint

ALTER TABLE "discount_redemptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "discount_redemptions" FOR ALL
  USING (organization_id = current_setting('app.current_org', true)::bigint)
  WITH CHECK (organization_id = current_setting('app.current_org', true)::bigint);
