-- Require approval, pay first (US-REG-02).
--
-- `requires_approval` is the event's rule COPIED onto the order when it is
-- placed: the buyer follows the rule they were told at checkout, however the
-- organizer flips the event's switch afterwards or while their payment is in
-- flight. No backfill — every existing order was placed without the rule.
--
-- `approval_requested_at` is when the organizer's decision became the only
-- thing left: at placement for a free order, when the money lands for a paid
-- one. "Awaiting approval" is `status = 'pending'` with this set, and the
-- expiry sweep in eventa-worker leaves such an order alone — it is on the
-- organizer's clock, not the buyer's.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "requires_approval" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "approval_requested_at" timestamptz;
