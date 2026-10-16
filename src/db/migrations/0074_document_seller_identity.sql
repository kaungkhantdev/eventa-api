-- An issued invoice or receipt keeps the seller identity it was issued with
-- (US-SET-07: "Given a document was already issued, when I later change the
-- organization details, then that past document is unchanged and only future
-- documents use the new details").
--
-- Neither table carried the seller: the printed invoice and the attendee's
-- portal receipt joined the LIVE organizations row at read time, so one edit
-- to the workspace's name, address or tax ID rewrote every document it had
-- ever issued. From here an invoice is stamped in the transaction that issues
-- it, and a payment in the transaction that settles it.
--
-- The backfill stamps the documents that already exist with the identity
-- they have been printing all along -- the organization row as it stands now,
-- which is the only record there is. That freezes them from this migration
-- on; it cannot recover a value that was overwritten before it. Payments are
-- stamped only once settled ('paid' or 'refunded'), the only ones a receipt
-- is shown for; a pending one is stamped when it settles.
--
-- Uses no enum value added here, so it is safe in one transaction. Runs as the
-- owning role, so RLS does not hide rows from it. updated_at is left alone:
-- this is a data fix, not an edit anybody made.
ALTER TABLE "payments" ADD COLUMN "seller_name" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "seller_address" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "seller_tax_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "seller_name" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "seller_address" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "seller_tax_id" text;--> statement-breakpoint
UPDATE "invoices" AS i
   SET "seller_name" = o."name",
       "seller_address" = o."address",
       "seller_tax_id" = o."tax_id"
  FROM "organizations" AS o
 WHERE o."id" = i."organization_id"
   AND i."seller_name" IS NULL;--> statement-breakpoint
UPDATE "payments" AS p
   SET "seller_name" = o."name",
       "seller_address" = o."address",
       "seller_tax_id" = o."tax_id"
  FROM "organizations" AS o
 WHERE o."id" = p."organization_id"
   AND p."status" IN ('paid', 'refunded')
   AND p."seller_name" IS NULL;
