CREATE TYPE "public"."admission_type" AS ENUM('general_admission', 'reserved_seat');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('onsale', 'scheduled', 'paused', 'soldout');--> statement-breakpoint
CREATE TABLE "ticket_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" bigint NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_free" boolean DEFAULT false NOT NULL,
	"price_satang" bigint DEFAULT 0 NOT NULL,
	"currency" char(3) DEFAULT 'THB' NOT NULL,
	"status" "ticket_status" DEFAULT 'scheduled' NOT NULL,
	"admission_type" "admission_type" DEFAULT 'general_admission' NOT NULL,
	"sold" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"sales_start_at" timestamp with time zone,
	"sales_end_at" timestamp with time zone,
	"min_per_order" integer DEFAULT 1 NOT NULL,
	"max_per_order" integer DEFAULT 8 NOT NULL,
	"icon_class" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ck_ticket_types_sold" CHECK ("ticket_types"."sold" >= 0 AND "ticket_types"."sold" <= "ticket_types"."total"),
	CONSTRAINT "ck_ticket_types_price" CHECK ("ticket_types"."price_satang" >= 0),
	CONSTRAINT "ck_ticket_types_free_price" CHECK (NOT "ticket_types"."is_free" OR "ticket_types"."price_satang" = 0)
);
--> statement-breakpoint
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_ticket_types_event" ON "ticket_types" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "ix_ticket_types_org" ON "ticket_types" USING btree ("organization_id");