ALTER TYPE "public"."audit_type" ADD VALUE 'checkin';--> statement-breakpoint
ALTER TABLE "check_ins" DROP CONSTRAINT "check_ins_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;