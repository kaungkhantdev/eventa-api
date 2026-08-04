ALTER TYPE "public"."notification_kind" ADD VALUE 'reminder';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'marketing';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "date_of_birth" date;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "display_currency" char(3);