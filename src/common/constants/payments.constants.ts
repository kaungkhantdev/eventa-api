import { paymentStatusEnum } from '../../db/schema/index';
import Stripe from 'stripe';
import { STRIPE_API_VERSION } from '../stripe/stripe-api-version';

/** The payments module's named constants. */

export const STATUSES = paymentStatusEnum.enumValues;

/** The three the story puts in scope for the ledger filter. */
export const METHODS = ['Card', 'PromptPay', 'Bank transfer'] as const;

export const MAX_LIMIT = 100;

export const MAX_SEARCH = 120;

export const MIN_IDEMPOTENCY_KEY = 8;

export const MAX_IDEMPOTENCY_KEY = 128;

export const MIN_KEY = 8;

export const MAX_KEY = 128;

/**
 * Every payment that took money. A settled refund flips its payment to
 * `refunded` (`markRefundedIn`), and that payment still collected its gross —
 * scanning `paid` alone dropped it from gross AND from refunds, so a completed
 * refund vanished from the report instead of showing as money that went back.
 */
export const COLLECTED: ('paid' | 'refunded')[] = ['paid', 'refunded'];

/** Only a refund that moved the money back counts as one (US-RPT-05). */
export const SETTLED_REFUND = 'succeeded';

export const DEFAULT_PAGE = 1;

export const DEFAULT_LIMIT = 20;

/** A hard ceiling on one export, so a huge workspace cannot exhaust memory. */
export const EXPORT_LIMIT = 10_000;

export const NOTHING_TO_EXPORT =
  'There is nothing to export — no payments match these filters.';

export const EXPORT_HEADER = [
  'date',
  'transaction',
  'payer',
  'event',
  'method',
  'status',
  'amount_baht',
  'currency',
];

/** Why an action is unavailable, in the words the story asks for. */
export const NO_COMPLETED_CHARGE = 'No completed charge yet.';

export const NOT_ELIGIBLE =
  'This attempt failed, so it is not eligible for refund.';

/** The ledger's hint for why Refund is disabled on a refunded row. */
export const REFUND_BLOCKED_REFUNDED_HINT =
  'This payment was already refunded.';

/** The header Stripe signs its callbacks with; the fake uses it too. */
export const SIGNATURE_HEADER = 'stripe-signature';

/** Tax periods and invoice dates are the organizer's calendar day, not UTC's. */
export const BANGKOK = 'Asia/Bangkok';

/**
 * Written for the buyer, who cannot fix this and did nothing wrong: it names
 * the organizer's setup rather than implying the attempt was at fault.
 */
export const NO_MERCHANT_ACCOUNT =
  'This event cannot take payment yet — the organizer has not finished connecting their payment account.';

/**
 * A refund that did not settle when it was issued, reported later: it went
 * through, or it failed (or was cancelled) and the money never went back.
 */
export const REFUND_WEBHOOK_TYPES = [
  'refund_succeeded',
  'refund_failed',
] as const;

export const MS_PER_SECOND = 1000;

export const THB = 'thb';

/** Stripe's documented Thai limits: ฿10 minimum, 8 digits maximum. */
export const MIN_THB_SATANG = 1_000;

export const MAX_THB_SATANG = 99_999_999;

/**
 * A card statement descriptor is Latin-only and the whole line (prefix + `* ` +
 * suffix) must fit 22 characters, so the suffix gets what is left.
 */
export const MAX_SUFFIX_LENGTH = 12;

export const MIN_SUFFIX_LENGTH = 5;

export const NON_LATIN = /[^A-Za-z0-9 ]/g;

/**
 * Where a workspace manages its own bank account, payout schedule, tax forms
 * and statements (US-FIN-05): its own Stripe dashboard. Test mode lives under
 * `/test`, and a key says which mode it belongs to (`sk_test_…`, `rk_live_…`).
 */
export const STRIPE_DASHBOARD = 'https://dashboard.stripe.com';

export const TEST_MODE_PATH = '/test';

export const PAYOUT_SETTINGS_PATH = '/settings/payouts';

export const TEST_MODE_KEY = /^(sk|rk)_test_/;

/** Stripe's code for "the buyer never completed it in time" (PromptPay lapse). */
export const ATTEMPT_EXPIRED = 'payment_intent_payment_attempt_expired';

/**
 * Refund statuses that mean "live at Stripe, not settled yet". A PromptPay
 * refund STARTS in `requires_action` — Stripe's documented flow for refunds
 * that require action — while it emails the buyer for a bank account, then
 * moves to `pending` and on to `succeeded`. Reading `requires_action` as failed
 * would leave the buyer with the money back AND valid tickets.
 */
export const REFUND_IN_FLIGHT: ReadonlySet<string> = new Set([
  'pending',
  'requires_action',
]);

/**
 * Signature checking is pure HMAC over the raw bytes — it never calls Stripe and
 * never uses an API key. One throwaway client exists only to reach that method;
 * the placeholder is never sent anywhere.
 */
export const WEBHOOK_VERIFIER = new Stripe('sk_signature_check_only', {
  apiVersion: STRIPE_API_VERSION,
});

export const NOT_PAID =
  'Only a completed payment can be refunded — this one never cleared.';

/** The 409 for refunding a payment twice. */
export const ALREADY_REFUNDED = 'This payment has already been refunded.';

export const NO_GATEWAY_REF =
  'This payment has no provider reference, so it cannot be refunded automatically.';

export const FINISHED_ELSEWHERE =
  'This refund was finished by another request — reload to see where it stands.';

export const NO_PAYMENT = 'There is no payment on this registration to refund.';

export const REFUSED_BEFORE =
  'An earlier attempt to refund it was refused by the provider.';

export const PAID = 'paid';

export const FAILED = 'failed';
