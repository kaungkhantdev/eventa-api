-- A workspace name identifies a real organizer to real attendees: it is what
-- appears on a ticket, an invoice and a receipt, and what somebody types at
-- sign-up. Two "Acme Events" make all three ambiguous.
--
-- The slug has always been unique; the name was not, which meant the two could
-- disagree — "Acme Events" resolving to acme-events while a second workspace of
-- the same name sat behind acme-events-2.
--
-- Normalized, because "Acme Events", "acme events" and " Acme Events " are the
-- same name to everybody except a byte comparison. Partial, so a deleted
-- workspace does not hold its name hostage forever. drizzle-kit cannot diff
-- either, hence --custom.
CREATE UNIQUE INDEX "uq_organizations_name"
  ON "organizations" (lower(btrim("name")))
  WHERE "deleted_at" IS NULL;
