-- Custom SQL migration file, put your code below! --

-- Row-Level Security for the social sign-in link table (tenant-owned; mirrors
-- 0002/0004/…/0015). Carries organization_id.
ALTER TABLE "social_identities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "social_identities" FOR ALL
  USING (organization_id = current_setting('app.current_org', true)::bigint)
  WITH CHECK (organization_id = current_setting('app.current_org', true)::bigint);
