-- One live account per (organization, email, persona) -- not one ever.
--
-- Removing a teammate (US-SET-11) and deleting an attendee account
-- (US-DISC-14) both soft-delete the `users` row and leave its email in place,
-- so the record of who did what survives. The constraint this replaces covered
-- those deleted rows too, so the address stayed taken for good: re-inviting a
-- removed teammate ("they can be re-invited later") and signing up again after
-- deleting an account (US-DISC-15) each inserted a duplicate and answered 500.
-- Every read that resolves an account by email already skips deleted rows;
-- now the uniqueness rule agrees with them.
--
-- Same name, so every reference to `uq_users_org_email_persona` still means
-- this rule. Nothing uses it as an ON CONFLICT target, which a partial index
-- could not serve without repeating its predicate.
ALTER TABLE "users" DROP CONSTRAINT "uq_users_org_email_persona";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_users_org_email_persona" ON "users" USING btree ("organization_id","email","persona") WHERE "users"."deleted_at" IS NULL;
