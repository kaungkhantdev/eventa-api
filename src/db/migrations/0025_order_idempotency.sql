ALTER TABLE "orders" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "uq_orders_org_idem" UNIQUE("organization_id","idempotency_key");