-- Bookkeeping for messages eventa-worker sends on a SCHEDULE (US-MSG-01/08).
--
-- The post-event thank-you and the event reminder are sent by jobs that run
-- every hour, and a job that runs again must not email everybody again. One
-- row per (event, kind) is the claim that a run began; `completed_at` says
-- every recipient was reached.
--
-- They are separate so a run that crashed halfway is RESUMED rather than
-- treated as done. Per-recipient repeats inside a resumed run are prevented by
-- the worker's delivery ledger.
--
-- One table for every scheduled kind rather than one per job: each has exactly
-- this shape, and a third job should be a new `kind`, not a new table.
CREATE TABLE IF NOT EXISTS "event_message_runs" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "organization_id" bigint NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "event_id" uuid NOT NULL,
  -- The catalog slug of the message: `post-event-thankyou`, `event-reminder`.
  "kind" text NOT NULL,
  "requested_at" timestamptz NOT NULL,
  "completed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "uq_event_message_runs" UNIQUE ("event_id", "kind")
);
--> statement-breakpoint
DO $$
BEGIN
  EXECUTE 'ALTER TABLE event_message_runs ENABLE ROW LEVEL SECURITY';
  EXECUTE
    'CREATE POLICY tenant_isolation ON event_message_runs FOR ALL '
    'USING (organization_id = current_setting(''app.current_org'', true)::bigint) '
    'WITH CHECK (organization_id = current_setting(''app.current_org'', true)::bigint)';
END $$;
