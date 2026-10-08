-- Feedback surveys an organizer writes for an event (US-MSG-09).
--
-- A survey belongs to an EVENT, not to the workspace: "how was it?" is a
-- question about something that happened, and a survey with no event has
-- nobody to ask.
--
-- `draft` collects nothing, which is the whole reason the status exists — a
-- survey must be writable before it is exposed to attendees, and half-written
-- questions reaching somebody's inbox is the failure this prevents. `closed`
-- is reversible on purpose: an organizer who closed one early should not have
-- to rebuild it.
--
-- Answering these is NOT part of this migration. Responses arrive from the
-- attendee portal (US-MSG-08/10) and get their own tables; nothing here
-- pretends to hold them.
CREATE TYPE "survey_status" AS ENUM ('draft', 'live', 'closed');
--> statement-breakpoint
CREATE TYPE "survey_question_type" AS ENUM ('rating', 'text', 'choice');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "surveys" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "organization_id" bigint NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "event_id" uuid NOT NULL,
  "title" text NOT NULL,
  "status" "survey_status" NOT NULL DEFAULT 'draft',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_surveys_org_event"
  ON "surveys" USING btree ("organization_id", "event_id");
--> statement-breakpoint
-- `position` is deliberately NOT unique: reordering under a unique constraint
-- means a temporary duplicate or a dance through negative numbers. Reads order
-- by position and break ties on id.
CREATE TABLE IF NOT EXISTS "survey_questions" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "organization_id" bigint NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "survey_id" bigint NOT NULL REFERENCES "surveys"("id") ON DELETE CASCADE,
  "position" integer NOT NULL,
  "type" "survey_question_type" NOT NULL,
  "prompt" text NOT NULL,
  -- Only meaningful for a `choice` question, and such a question is invalid
  -- with fewer than two. Enforced in the service, where it can say why.
  "options" text[] NOT NULL DEFAULT '{}',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_survey_questions_survey"
  ON "survey_questions" USING btree ("survey_id", "position");
--> statement-breakpoint
-- Tenant isolation, matching every other tenant table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['surveys', 'survey_questions']
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
