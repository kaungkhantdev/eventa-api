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

// A bucket is required to boot, so CI needs one named even though no suite
// writes to it — the one suite that uploads overrides `ObjectStoragePort` with
// the in-process double. A name that is obviously not a real bucket, so a
// misdirected request cannot land somewhere that exists.
process.env.S3_BUCKET ??= 'eventa-test-no-such-bucket';
process.env.S3_REGION ??= 'ap-southeast-1';
