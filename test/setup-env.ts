/**
 * Environment every e2e run needs before the app boots.
 *
 * No Stripe key here, and there is nowhere for one to go: keys belong to a
 * workspace now, pasted in Settings → Payments and stored encrypted, so the
 * env schema does not declare them and nothing reads them. Suites that start a
 * payment override `PaymentProviderPort` with `StubPaymentProvider`, and the
 * one suite that boots on the real adapter only exercises its local signature
 * verification, which needs no key at all.
 *
 * `??=` throughout, so a value already in the shell still wins.
 */
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgres://eventa:eventa@localhost:5432/eventa';
process.env.JWT_SECRET ??= 'test-secret-at-least-16-characters-long';
