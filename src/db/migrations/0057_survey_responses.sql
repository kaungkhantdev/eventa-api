-- Attendees' answers to a survey (US-MSG-08/10).
--
-- A response is SIGNED IN and unique per (survey, person). An anonymous link
-- would let anyone holding the URL push an event's rating wherever they liked,
-- and a satisfaction figure that can be stuffed is worse than no figure — an
-- organizer would act on it.
--
-- It cascades from the user: deleting an account takes that person's feedback
-- with it, which is both what account deletion should mean and what keeps "one
-- response per person" true rather than leaving an orphan nobody can attribute.
CREATE TABLE IF NOT EXISTS "survey_responses" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "organization_id" bigint NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "survey_id" bigint NOT NULL REFERENCES "surveys"("id") ON DELETE CASCADE,
  -- Denormalised from the survey so an event's figures are one join fewer.
  "event_id" uuid NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "submitted_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "uq_survey_responses_person" UNIQUE ("survey_id", "user_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_survey_responses_org_event"
  ON "survey_responses" USING btree ("organization_id", "event_id");
--> statement-breakpoint
-- Three columns, one per question type, exactly one filled. A single `value`
-- text column would have meant parsing "4" back into a number every time an
-- average was taken, and an average is the whole point of a rating.
CREATE TABLE IF NOT EXISTS "survey_answers" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "organization_id" bigint NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "response_id" bigint NOT NULL REFERENCES "survey_responses"("id") ON DELETE CASCADE,
  "question_id" bigint NOT NULL REFERENCES "survey_questions"("id") ON DELETE CASCADE,
  "rating" integer,
  "answer_text" text,
  "choice" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_survey_answers_response"
  ON "survey_answers" USING btree ("response_id");
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['survey_responses', 'survey_answers']
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
