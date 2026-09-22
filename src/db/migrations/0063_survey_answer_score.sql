-- Where a recommendation answer goes: a fourth column, one per question type,
-- exactly one filled (US-MSG-08).
--
-- Not `rating`. Every read of that column — the average, the star breakdown,
-- the rating lifted into the responses list, the rating filter — takes "rating
-- is not null" as "a star rating", with no join to the question's type. A 0 or
-- a 9 stored there would drag the average and invent stars the 1–5 scale does
-- not have. Its own column keeps each figure reading only what it measures.
--
-- The CHECK is on the value, not on the question type: it must not name the
-- new enum value, which 0062 adds in the same transaction.
ALTER TABLE "survey_answers" ADD COLUMN IF NOT EXISTS "score" smallint
  CONSTRAINT "ck_survey_answers_score" CHECK ("score" BETWEEN 0 AND 10);
