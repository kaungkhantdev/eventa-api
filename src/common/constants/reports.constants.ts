import { EXPORT_MIME } from '../export/tabular';

/** The reports module's named constants. */

export const ALL_EVENTS = 'All events';

export const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const DAY_MESSAGE = 'must be a calendar day, as YYYY-MM-DD';

export const DEFAULT_REPORT_LIMIT = 20;

export const MAX_REPORT_LIMIT = 100;

export const PERCENT = 100;

/** Where a code is in its life, as Discounts already settles it. */
export const DISCOUNT_STANDINGS = [
  'active',
  'scheduled',
  'expired',
  'disabled',
] as const;

/**
 * Where an event is in its life, worked out from the clock rather than read off
 * `events.status`.
 *
 * The column is not maintained past publication — nothing in the API or the
 * worker ever advances a row to `live` or `completed` — so trusting it would
 * badge last year's conference "Upcoming". `cancelled` IS trustworthy, because
 * it is written deliberately, and it wins over the clock: an event that was
 * called off did not quietly "complete".
 */
export const EVENT_LIFECYCLES = [
  'upcoming',
  'live',
  'completed',
  'cancelled',
] as const;

export const REPORT_PAYOUT_STATUSES = [
  'paid',
  'in_transit',
  'pending',
] as const;

/**
 * How an entry ended up.
 *
 * `refunded` belongs to a PAYMENT that has been reversed, not to the refund
 * itself — the refund's own outcome is `succeeded`, `pending` or `failed`.
 */
export const LEDGER_OUTCOMES = [
  'succeeded',
  'pending',
  'refunded',
  'failed',
] as const;

/** Down is the improvement: refunds, fees, cancellations, no-shows. */
export const LOWER_IS_BETTER = { higherIsBetter: false } as const;

export const SCOPE_SEPARATOR = ' · ';

/** The reports that can be exported, which is every report with rows. */
export const EXPORTABLE = [
  'registrations',
  'attendance',
  'events',
  'income',
  'discounts',
  'transactions',
  'payouts',
] as const;

/**
 * How many rows an export will carry.
 *
 * A ceiling rather than no limit at all: the story's "very large export"
 * criterion asks for a prepared file and a notification, which is a separate
 * slice — until then a report that would run to tens of thousands of rows is
 * truncated rather than allowed to time out mid-download. The workbook and the
 * PDF say when they have been cut.
 *
 * One ceiling for all three formats, though they do not cost the same: see the
 * capacity note in `common/export/pdf` for what a full one costs the event
 * loop, and why a PDF-only ceiling is a decision rather than a tweak.
 */
export const EXPORT_LIMIT = 5000;

/** One millisecond inside the last day, since `period.to` is exclusive. */
export const LAST_INSTANT = 1;

/** What follows a fixed code's amount, in the phrase the screen uses. */
export const OFF = 'off';

export const SATANG_PER_BAHT = 100;

/** The ranges the overview's toggle offers (US-RPT-01). */
export const REPORT_RANGES = ['7d', '30d', '90d', 'year'] as const;

/**
 * Two years and the leap day between them.
 *
 * US-RPT-02 caps a span at 24 months. Expressed in days because every other
 * window in this codebase is day arithmetic, and because a calendar-month cap
 * would make the limit itself depend on which months were asked for.
 */
export const MAX_SPAN_DAYS = 731;

export const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Every MIME an export route can answer with, for the OpenAPI document. */
export const PRODUCES = Object.values(EXPORT_MIME);

export const TREND_GRANULARITIES = ['day', 'week', 'month'] as const;

/** Beyond these, a daily (then weekly) chart stops being readable. */
export const MAX_DAILY_DAYS = 31;

export const MAX_WEEKLY_DAYS = 120;
