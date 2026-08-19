-- Custom SQL migration file, put your code below! --

-- Row-Level Security for the public-page content tables (tenant-owned; mirrors
-- 0002/0004/…/0018). Both carry organization_id.
--
-- NOTE: the PUBLIC page reads these through a SECURITY DEFINER path scoped by the
-- event's own organization_id — an anonymous visitor has no tenant context, and
-- must never be able to set one.
ALTER TABLE "event_highlights" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "event_highlights" FOR ALL
  USING (organization_id = current_setting('app.current_org', true)::bigint)
  WITH CHECK (organization_id = current_setting('app.current_org', true)::bigint);--> statement-breakpoint

ALTER TABLE "event_faqs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "event_faqs" FOR ALL
  USING (organization_id = current_setting('app.current_org', true)::bigint)
  WITH CHECK (organization_id = current_setting('app.current_org', true)::bigint);
