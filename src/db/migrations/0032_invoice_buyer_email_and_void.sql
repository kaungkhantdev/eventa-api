ALTER TABLE "invoices" ADD COLUMN "buyer_email" "citext" NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "voided_by" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_invoices_due" ON "invoices" USING btree ("organization_id","due_at");