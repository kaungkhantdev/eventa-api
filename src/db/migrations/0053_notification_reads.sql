-- How far one member has read their notification feed (US-MSG-03).
--
-- A WATERMARK, not a row per notification. The feed is derived from
-- registrations, payments and payouts as they already stand — nothing writes a
-- notification when those things happen — so there is nothing to mark read one
-- at a time. "Unread" means "happened after this instant", and the whole of
-- "mark all read" is moving this timestamp forward.
--
-- One row per (organization, member). A colleague clearing their own feed must
-- not clear anybody else's, and a member belonging to two workspaces reads each
-- of them separately.
CREATE TABLE IF NOT EXISTS "notification_reads" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "organization_id" bigint NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "read_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "uq_notification_reads_member" UNIQUE ("organization_id", "user_id")
);

-- Tenant isolation, matching every other tenant table. Defence in depth: the app
-- also scopes every query by organization_id.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['notification_reads']
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
