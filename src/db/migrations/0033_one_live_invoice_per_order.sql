-- Issuing an invoice twice for the same order must produce ONE invoice
-- (US-FIN-07), but a correction is a void plus a brand-new invoice
-- (US-FIN-10) — so the constraint has to ignore voided rows. A partial unique
-- index says exactly that, and drizzle-kit cannot diff one, hence --custom.
CREATE UNIQUE INDEX "uq_invoices_live_order"
  ON "invoices" ("order_id")
  WHERE "status" <> 'void';
