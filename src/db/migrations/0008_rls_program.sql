-- Custom SQL migration file, put your code below! --

-- Row-Level Security for the Program tables (tenant-owned; mirrors 0002/0004/0006).
ALTER TABLE "speakers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "speakers" FOR ALL
  USING (organization_id = current_setting('app.current_org', true)::bigint)
  WITH CHECK (organization_id = current_setting('app.current_org', true)::bigint);--> statement-breakpoint

ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sessions" FOR ALL
  USING (organization_id = current_setting('app.current_org', true)::bigint)
  WITH CHECK (organization_id = current_setting('app.current_org', true)::bigint);--> statement-breakpoint

-- session_speakers has no organization_id (entities.md); isolate it through its
-- parent session's tenant instead.
ALTER TABLE "session_speakers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "session_speakers" FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "sessions" s
      WHERE s.id = "session_speakers".session_id
        AND s.organization_id = current_setting('app.current_org', true)::bigint
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "sessions" s
      WHERE s.id = "session_speakers".session_id
        AND s.organization_id = current_setting('app.current_org', true)::bigint
    )
  );
