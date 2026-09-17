-- Bring the `permissions` table up to the catalog in code.
--
-- The catalog has always been the source of truth for a permission's group and
-- label, but `ensureCatalog` inserted with ON CONFLICT DO NOTHING — so a key
-- seeded before its label was written kept the empty value forever. The Roles
-- editor then fell back to spacing out the key, and offered somebody deciding
-- what a role may do the choice "Ev create", "Reg view", "Fin manage".
--
-- The wording matches `eventa-ui-kit/admin/roles.html`, which is where these
-- are actually read. Only group and label move: the key is the identity and
-- `role_permissions` references it.
--
-- Idempotent, and safe to run against a database that is already correct.
INSERT INTO "permissions" ("key", "group", "label") VALUES
  ('evCreate', 'Events', 'Create & edit events'),
  ('evPublish', 'Events', 'Publish & cancel events'),
  ('evSpeakers', 'Events', 'Manage speakers & agenda'),
  ('evProgramView', 'Events', 'View agenda & speakers'),
  ('regView', 'Registrations', 'View registrations & attendees'),
  ('regCheckin', 'Registrations', 'Check attendees in'),
  ('regExport', 'Registrations', 'Export attendee data'),
  ('regManage', 'Registrations', 'Approve, add & invite registrations'),
  ('finView', 'Finance', 'View payments & payouts'),
  ('finRefund', 'Finance', 'Issue refunds'),
  ('finDiscount', 'Finance', 'Manage discounts & pricing'),
  ('finManage', 'Finance', 'Void invoices, payouts & VAT filing'),
  ('setUsers', 'Settings', 'Manage users & roles'),
  ('setSettings', 'Settings', 'Edit workspace settings'),
  ('setIntegrations', 'Settings', 'Manage integrations')
ON CONFLICT ("key") DO UPDATE
  SET "group" = excluded."group",
      "label" = excluded."label";
