CREATE TYPE "public"."meeting_mode" AS ENUM('Video', 'In person', 'Phone');--> statement-breakpoint
CREATE TYPE "public"."meeting_status" AS ENUM('scheduled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."meeting_sync_status" AS ENUM('pending', 'synced', 'failed', 'not_connected');--> statement-breakpoint
CREATE TYPE "public"."meeting_type" AS ENUM('Venue', 'Sponsor', 'Vendor', 'Speaker', 'Internal');--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" bigint NOT NULL,
	"title" text NOT NULL,
	"meeting_date" date NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"type" "meeting_type" NOT NULL,
	"mode" "meeting_mode" NOT NULL,
	"status" "meeting_status" DEFAULT 'scheduled' NOT NULL,
	"person" text NOT NULL,
	"role" text,
	"guest_email" "citext" NOT NULL,
	"event_id" uuid,
	"link" text,
	"location" text,
	"notes" text,
	"cancellation_reason" text,
	"cancelled_at" timestamp with time zone,
	"sync_status" "meeting_sync_status" DEFAULT 'pending' NOT NULL,
	"external_event_id" text,
	"sync_error" text,
	"idempotency_key" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "uq_meetings_org_idem" UNIQUE("organization_id","idempotency_key"),
	CONSTRAINT "ck_meetings_times" CHECK ("meetings"."end_time" > "meetings"."start_time")
);
--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_meetings_event" ON "meetings" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "ix_meetings_date" ON "meetings" USING btree ("organization_id","meeting_date","start_time");--> statement-breakpoint
CREATE INDEX "ix_meetings_sync" ON "meetings" USING btree ("organization_id","sync_status");