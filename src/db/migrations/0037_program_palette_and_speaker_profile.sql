ALTER TYPE "public"."session_color" ADD VALUE 'blue';--> statement-breakpoint
ALTER TYPE "public"."session_color" ADD VALUE 'slate';--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "speakers" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "speakers" ADD COLUMN "photo_url" text;--> statement-breakpoint
ALTER TABLE "speakers" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "speakers" ADD COLUMN "social_links" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_speakers_event_email" ON "speakers" USING btree ("event_id","email") WHERE "speakers"."email" IS NOT NULL AND "speakers"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_speakers_name" ON "speakers" USING btree ("event_id","name");