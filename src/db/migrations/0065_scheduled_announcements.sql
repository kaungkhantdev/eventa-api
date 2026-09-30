-- Sending an announcement later, and changing your mind before it goes
-- (US-MSG-04/05).
--
-- 0054 made `announcements` a record of sends that had already happened: the
-- row and the outbox event that delivers it were written together. A scheduled
-- one is written WITHOUT its outbox event. eventa-worker's sweep claims it when
-- its time comes and, in one transaction, marks it `sent` and writes exactly the
-- outbox row the API writes for a send-now — so delivery, the per-recipient
-- ledger and the delivery log are the same path either way.
--
-- A new type, not ADD VALUE on an existing one: Postgres cannot use an enum
-- value added in the same transaction, but a type created in it is fine.
DO $$
BEGIN
  CREATE TYPE "announcement_status" AS ENUM ('scheduled', 'sent', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
-- Every existing row went out when it was written.
ALTER TABLE "announcements"
  ADD COLUMN IF NOT EXISTS "status" "announcement_status" NOT NULL DEFAULT 'sent';
--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "scheduled_for" timestamptz;
--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamptz;
--> statement-breakpoint
-- Null on a cancelled row means nobody did: the worker drops a due announcement
-- whose event has since been deleted, as a send-now to it would 404.
ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "cancelled_by_user_id" uuid
  REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
-- A scheduled announcement has not been sent, and nobody has counted its
-- audience yet — it is resolved afresh when it goes. NULL, not 0: "not counted"
-- and "counted nobody" are different facts.
ALTER TABLE "announcements" ALTER COLUMN "sent_at" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "announcements" ALTER COLUMN "recipient_count" DROP NOT NULL;
--> statement-breakpoint
-- The states and their columns agree, whoever writes the row — the API or the
-- worker's hand-written SQL. Existing rows are `sent` with both columns set.
DO $$
BEGIN
  ALTER TABLE "announcements" ADD CONSTRAINT "ck_announcements_state" CHECK (
    ("status" = 'sent' AND "sent_at" IS NOT NULL AND "recipient_count" IS NOT NULL)
    OR ("status" = 'scheduled' AND "scheduled_for" IS NOT NULL AND "sent_at" IS NULL)
    OR ("status" = 'cancelled' AND "cancelled_at" IS NOT NULL AND "sent_at" IS NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
-- The sweep's question, every minute: which scheduled ones are due?
CREATE INDEX IF NOT EXISTS "ix_announcements_due"
  ON "announcements" USING btree ("scheduled_for")
  WHERE "status" = 'scheduled';
