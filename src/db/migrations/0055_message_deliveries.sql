-- One outbound message and what became of it (US-MSG-06).
--
-- Written by eventa-worker as it sends, one row per RECIPIENT. A broadcast to
-- 1,340 attendees is 1,340 rows, and that is the point: "prove messages were
-- delivered and diagnose failures" is a question about individuals, and a
-- per-message summary cannot answer which address bounced.
--
-- `status` is what the transport said and nothing more. There is deliberately
-- no `delivered` and no `opened` — those need a provider webhook and a tracking
-- pixel, and this product has neither. Enum values are add-only, so they can
-- join the day something actually knows.
--
-- `kind` is free text, not an enum: the worker is what knows the message it
-- just sent, and a new message type should not need a migration in another
-- repo before it can be logged.
CREATE TYPE "delivery_status" AS ENUM ('sent', 'failed');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_deliveries" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "organization_id" bigint NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "event_id" uuid,
  "kind" text NOT NULL,
  "channel" "message_channel" NOT NULL DEFAULT 'email',
  "recipient_email" text NOT NULL,
  "recipient_name" text,
  "status" "delivery_status" NOT NULL,
  "error" text,
  "sent_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- The log is newest-first per workspace, and filtered by outcome.
CREATE INDEX IF NOT EXISTS "ix_message_deliveries_org_sent"
  ON "message_deliveries" USING btree ("organization_id", "sent_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_message_deliveries_org_status"
  ON "message_deliveries" USING btree ("organization_id", "status");
--> statement-breakpoint
-- Tenant isolation, matching every other tenant table. Defence in depth: the
-- app also scopes every query by organization_id.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE message_deliveries ENABLE ROW LEVEL SECURITY';
  EXECUTE
    'CREATE POLICY tenant_isolation ON message_deliveries FOR ALL '
    'USING (organization_id = current_setting(''app.current_org'', true)::bigint) '
    'WITH CHECK (organization_id = current_setting(''app.current_org'', true)::bigint)';
END $$;
