-- The registration confirmation is now TEXTED as well as emailed (US-DISC-06
-- AC5), and eventa-worker sends that text only when 'sms' is in this row's
-- `channels`.
--
-- `channels` is written once, on a row's first insert, and never updated — so
-- every existing row holds a COPY of the catalog as it stood the day that
-- workspace first touched the message, which was email-only. That '{email}' is
-- not an organizer's choice about SMS; nothing has ever let them make one.
-- Left alone, a workspace that once reworded or switched its confirmation
-- would silently get no texts while its card showed an SMS badge.
--
-- Safe inside drizzle's single transaction: 'sms' has been a `message_channel`
-- value since 0028, and Postgres only refuses an enum value added in the SAME
-- transaction. Idempotent, so a re-run appends nothing. Migrations run as the
-- owning role, so RLS does not hide rows from it.
--
-- `updated_at` is deliberately NOT touched: this is a data fix, not an edit
-- anybody made.
UPDATE "message_templates"
   SET "channels" = array_append("channels", 'sms'::message_channel)
 WHERE "slug" = 'registration-confirmation'
   AND NOT ('sms'::message_channel = ANY("channels"));
