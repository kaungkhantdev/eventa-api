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
});
