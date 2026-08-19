/**
 * Environment every e2e run needs before the app boots.
 *
 * Stripe's keys are REQUIRED by the env schema now that Stripe is the only
 * payment provider — there is no in-process stand-in to fall back on. These are
 * obvious non-keys, and nothing here reaches Stripe's network: suites that
 * start a payment override `PaymentProviderPort` with `StubPaymentProvider`,
 * and the one suite that boots on the real adapter only exercises its local
 * signature verification.
 *
 * `??=` throughout, so a real test-mode key in the shell still wins.
 */
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgres://eventa:eventa@localhost:5432/eventa';
process.env.JWT_SECRET ??= 'test-secret-at-least-16-characters-long';
process.env.STRIPE_SECRET_KEY ??= 'sk_test_e2e_not_a_real_key';
process.env.STRIPE_WEBHOOK_SECRET ??= 'whsec_fake';
