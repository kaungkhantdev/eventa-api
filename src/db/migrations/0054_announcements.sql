-- Broadcasts an organizer sent to an event's attendees (US-MSG-04).
--
-- A RECORD of a send, not a queue. The sending is already done by the outbox
-- event written in the same transaction — this row exists so the organizer can
-- see what they have sent, which is the one thing the "email all attendees"
-- path (US-EVT-14) could not answer. Row and outbox event live or die
-- together: an announcement listed but never sent, and one sent but never
-- listed, are both wrong.
--
-- `recipient_count` is the attendee count AT THE MOMENT IT WAS QUEUED.
-- eventa-worker resolves the real recipients when it sends, so this is what the
-- organizer was told they were writing to, not a delivery receipt. Proving
-- delivery is US-MSG-06 and needs a per-recipient table this one is not.
--
-- No schedule column and no audience column: nothing in the product can send
-- later, and the broadcast path takes one event's confirmed attendees. Either
-- column would be a promise the send path cannot keep.
CREATE TABLE IF NOT EXISTS "announcements" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "organization_id" bigint NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "event_id" uuid NOT NULL,
  "subject" text NOT NULL,
  "body" text NOT NULL,
  "recipient_count" bigint NOT NULL,
  -- Kept when the sender leaves the workspace: the send still happened, and a
  -- record that loses its author is worse than one naming somebody who has gone.
  "sent_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "sent_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- The list is newest-first per workspace, and filtered by event.
CREATE INDEX IF NOT EXISTS "ix_announcements_org_sent"
  ON "announcements" USING btree ("organization_id", "sent_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_announcements_event"
  ON "announcements" USING btree ("organization_id", "event_id");
--> statement-breakpoint
-- Tenant isolation, matching every other tenant table. Defence in depth: the app
-- also scopes every query by organization_id.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE announcements ENABLE ROW LEVEL SECURITY';
  EXECUTE
    'CREATE POLICY tenant_isolation ON announcements FOR ALL '
    'USING (organization_id = current_setting(''app.current_org'', true)::bigint) '
    'WITH CHECK (organization_id = current_setting(''app.current_org'', true)::bigint)';
END $$;
