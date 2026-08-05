import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const base = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    JWT_SECRET: 'a-sufficiently-long-test-secret',
  };

  it('rejects an env missing DATABASE_URL', () => {
    expect(() => validateEnv({ JWT_SECRET: base.JWT_SECRET })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rejects a too-short JWT_SECRET', () => {
    expect(() =>
      validateEnv({ DATABASE_URL: base.DATABASE_URL, JWT_SECRET: 'short' }),
    ).toThrow(/JWT_SECRET/);
  });

  it('applies defaults', () => {
    const env = validateEnv(base);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.CORS_ORIGINS).toBe('*');
    expect(env.JWT_ACCESS_TTL).toBe(900);
    expect(env.JWT_REFRESH_TTL).toBe(604800);
  });

  it('coerces PORT from string to number', () => {
    const env = validateEnv({ ...base, PORT: '8080' });
    expect(env.PORT).toBe(8080);
  });

  it('parses EMIT_OPENAPI into a boolean', () => {
    expect(validateEnv({ ...base, EMIT_OPENAPI: 'true' }).EMIT_OPENAPI).toBe(
      true,
    );
    expect(validateEnv({ ...base, EMIT_OPENAPI: 'false' }).EMIT_OPENAPI).toBe(
      false,
    );
  });

  it('rejects an invalid NODE_ENV', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'staging' })).toThrow(
      /NODE_ENV/,
    );
  });

  describe('payments (US-DISC-05)', () => {
    it('defaults to the fake provider, so nothing charges a card by accident', () => {
      const env = validateEnv(base);
      expect(env.PAYMENT_PROVIDER).toBe('fake');
      expect(env.PROMPTPAY_EXPIRY_SECONDS).toBe(900);
    });

    it('refuses to boot on the real provider with no secret key', () => {
      expect(() =>
        validateEnv({
          ...base,
          PAYMENT_PROVIDER: 'stripe',
          STRIPE_WEBHOOK_SECRET: 'whsec_test',
        }),
      ).toThrow(/STRIPE_SECRET_KEY/);
    });

    it('refuses to boot on the real provider with no webhook secret', () => {
      // Without it every webhook would have to be trusted unverified.
      expect(() =>
        validateEnv({
          ...base,
          PAYMENT_PROVIDER: 'stripe',
          STRIPE_SECRET_KEY: 'sk_test',
        }),
      ).toThrow(/STRIPE_WEBHOOK_SECRET/);
    });

    it('accepts the real provider once both secrets are present', () => {
      const env = validateEnv({
        ...base,
        PAYMENT_PROVIDER: 'stripe',
        STRIPE_SECRET_KEY: 'sk_test',
        STRIPE_WEBHOOK_SECRET: 'whsec_test',
      });
      expect(env.PAYMENT_PROVIDER).toBe('stripe');
    });

    it('coerces the PromptPay window from a string', () => {
      expect(
        validateEnv({ ...base, PROMPTPAY_EXPIRY_SECONDS: '600' })
          .PROMPTPAY_EXPIRY_SECONDS,
      ).toBe(600);
    });
  });

  describe('object storage (US-DISC-11)', () => {
    it('defaults to in-process storage, so local dev needs no AWS account', () => {
      const env = validateEnv(base);
      expect(env.STORAGE_PROVIDER).toBe('memory');
      expect(env.UPLOAD_MAX_BYTES).toBe(5_242_880);
      expect(env.UPLOAD_URL_TTL_SECONDS).toBe(300);
    });

    it('refuses to boot on s3 without a bucket', () => {
      expect(() =>
        validateEnv({
          ...base,
          STORAGE_PROVIDER: 's3',
          S3_REGION: 'ap-southeast-1',
        }),
      ).toThrow(/S3_BUCKET/);
    });

    it('refuses to boot on s3 without a region', () => {
      expect(() =>
        validateEnv({ ...base, STORAGE_PROVIDER: 's3', S3_BUCKET: 'b' }),
      ).toThrow(/S3_REGION/);
    });

    it('accepts s3 once the bucket and region are named', () => {
      const env = validateEnv({
        ...base,
        STORAGE_PROVIDER: 's3',
        S3_BUCKET: 'eventa-uploads',
        S3_REGION: 'ap-southeast-1',
      });
      expect(env.STORAGE_PROVIDER).toBe('s3');
    });

    it('trims a trailing slash off the public base so URLs never double up', () => {
      const env = validateEnv({
        ...base,
        S3_PUBLIC_BASE_URL: 'https://cdn.eventa.co.th/',
      });
      expect(env.S3_PUBLIC_BASE_URL).toBe('https://cdn.eventa.co.th');
    });
  });

  describe('production refuses the fake provider', () => {
    it('will not boot in production on the fake provider', () => {
      // The fake signs webhooks with a constant; in production that is a public
      // HMAC key, and anyone who knows it can POST themselves free tickets.
      expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).toThrow(
        /PAYMENT_PROVIDER/,
      );
    });

    it('boots in production on the real provider', () => {
      const env = validateEnv({
        ...base,
        NODE_ENV: 'production',
        PAYMENT_PROVIDER: 'stripe',
        STRIPE_SECRET_KEY: 'sk_live_realmoney',
        STRIPE_WEBHOOK_SECRET: 'whsec_live',
      });
      expect(env.PAYMENT_PROVIDER).toBe('stripe');
    });
  });

  describe('Stripe key mode (US-DISC-05)', () => {
    it('refuses a LIVE secret key outside production — a test run must not charge anyone', () => {
      expect(() =>
        validateEnv({
          ...base,
          NODE_ENV: 'development',
          PAYMENT_PROVIDER: 'stripe',
          STRIPE_SECRET_KEY: 'sk_live_realmoney',
          STRIPE_WEBHOOK_SECRET: 'whsec_test',
        }),
      ).toThrow(/live/i);
    });

    it('refuses a live RESTRICTED key outside production too', () => {
      expect(() =>
        validateEnv({
          ...base,
          NODE_ENV: 'development',
          PAYMENT_PROVIDER: 'stripe',
          STRIPE_SECRET_KEY: 'rk_live_restricted',
          STRIPE_WEBHOOK_SECRET: 'whsec_test',
        }),
      ).toThrow(/live/i);
    });

    it('accepts a live key in production', () => {
      const env = validateEnv({
        ...base,
        NODE_ENV: 'production',
        PAYMENT_PROVIDER: 'stripe',
        STRIPE_SECRET_KEY: 'sk_live_realmoney',
        STRIPE_WEBHOOK_SECRET: 'whsec_live',
      });
      expect(env.STRIPE_SECRET_KEY).toBe('sk_live_realmoney');
    });

    it('refuses a live key even on the fake provider — it must not be lying around', () => {
      // Inert today, but one PAYMENT_PROVIDER=stripe away from charging real
      // cards from a developer's machine. Refuse the key, not just its use.
      expect(() =>
        validateEnv({
          ...base,
          NODE_ENV: 'development',
          STRIPE_SECRET_KEY: 'sk_live_leftover',
        }),
      ).toThrow(/live/i);
    });

    it('accepts a test key outside production', () => {
      const env = validateEnv({
        ...base,
        NODE_ENV: 'test',
        PAYMENT_PROVIDER: 'stripe',
        STRIPE_SECRET_KEY: 'sk_test_abc123',
        STRIPE_WEBHOOK_SECRET: 'whsec_test',
      });
      expect(env.PAYMENT_PROVIDER).toBe('stripe');
    });
  });
});
