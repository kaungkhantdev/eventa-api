-- A category name is unique among the workspace's LIVE categories, ignoring
-- case (US-EVT-11: "the name must be unique in my workspace and duplicates
-- are rejected").
--
-- EventCategoriesService has always checked it that way -- lower(name), and
-- only rows with deleted_at IS NULL -- but the constraint this replaces was
-- case-sensitive and covered soft-deleted rows. So re-creating a deleted
-- category, or renaming one to a deleted category's name, passed the check,
-- hit the constraint and answered 500, while "Music" and "music" created at
-- the same moment could both get in. The index now holds the service's rule.
--
-- No backfill. The service has refused case-insensitive duplicates among live
-- rows since categories were built, so a collision here would need two
-- creates that raced. If one exists, this fails loudly rather than guessing
-- which of the two categories to keep.
ALTER TABLE "categories" DROP CONSTRAINT "uq_categories_org_name";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_categories_org_name" ON "categories" USING btree ("organization_id",lower("name")) WHERE "categories"."deleted_at" IS NULL;
