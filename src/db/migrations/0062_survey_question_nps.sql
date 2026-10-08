-- A 0–10 "how likely are you to recommend…" question, the one NPS is built
-- from (US-MSG-08/09). It carries no options, like a rating.
--
-- Alone in its file, and nothing else in any migration shipped with it may
-- USE the value — no CHECK naming it, no seed, no backfill. Postgres refuses to
-- use an enum value in the transaction that added it ("unsafe use of new
-- value"), and drizzle-kit applies every pending migration in ONE transaction,
-- so a later file in the same batch touching 'nps' would roll the whole batch
-- back. Enum values are add-only; the code that writes it can follow later.
ALTER TYPE "survey_question_type" ADD VALUE IF NOT EXISTS 'nps';
