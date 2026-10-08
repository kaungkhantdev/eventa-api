-- One answer per question per response (US-MSG-08).
--
-- Every figure counts ANSWERS, not people: thirty scores of 10 inside one
-- response are thirty promoters in the NPS, and thirty fives in the average.
-- The (survey, user) unique on survey_responses cannot stop that, because the
-- duplicates all sit inside the one response it allows. The submit rule
-- refuses a repeated question first; this is what still holds for any write
-- path that skips it.
--
-- Duplicates already stored are resolved before the constraint lands, since
-- adding it over them would fail outright. The answer given FIRST (lowest id)
-- is kept: it is the one the person gave before any copies were piled on.
DELETE FROM "survey_answers" AS later
USING "survey_answers" AS earlier
WHERE later."response_id" = earlier."response_id"
  AND later."question_id" = earlier."question_id"
  AND later."id" > earlier."id";
--> statement-breakpoint
ALTER TABLE "survey_answers"
  ADD CONSTRAINT "uq_survey_answers_question" UNIQUE ("response_id", "question_id");
