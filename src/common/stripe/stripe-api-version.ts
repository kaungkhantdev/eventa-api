/**
 * The Stripe API version every client in this service pins.
 *
 * Shared rather than per-adapter: two clients on two versions would disagree
 * about the same account — one reporting a field the other cannot see — and
 * that disagreement would surface as a payment bug, not a type error.
 *
 * Pinned by the installed SDK: `Stripe.LatestApiVersion` accepts nothing else.
 */
export const STRIPE_API_VERSION = '2026-07-29.dahlia';
