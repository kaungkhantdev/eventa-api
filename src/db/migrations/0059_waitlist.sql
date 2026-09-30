-- The waitlist (US-REG-04).
--
-- A waitlist entry is a registration in the existing `waitlisted` status: it
-- names a ticket type and a quantity, is priced when it joins, and holds no
-- seat. An OFFER turns it `pending` with a seat hold that lasts the offer
-- window, so paying for it is the ordinary checkout payment; an offer nobody
-- takes up is expired by eventa-worker's unpaid-order sweep, which then offers
-- the seat to the next person in line.
--
-- These columns record the offer on the registration itself, so "who got it,
-- when, until when, and who was passed over" is one row, not a log to join.
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "waitlist_enabled" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "offered_at" timestamptz;
--> statement-breakpoint
-- Null with `offered_at` set: the queue passed a lapsed offer on by itself.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "offered_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "offer_expires_at" timestamptz;
--> statement-breakpoint
-- How many were ahead in line when an organizer chose this one; 0 = in order.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "offer_skipped" smallint;
