import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const base = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    JWT_SECRET: 'a-sufficiently-long-test-secret',
    // Required now: card payment runs through Stripe and only Stripe, so the
    // app refuses to boot without the keys rather than discovering they are
    // missing at the till.
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
    it('applies the PromptPay default', () => {
      expect(validateEnv(base).PROMPTPAY_EXPIRY_SECONDS).toBe(900);
    });

    /**
     * There is no platform Stripe key, and its absence is the safety property:
     * credentials are per workspace, so a fallback key would silently take one
     * organizer's money into another's account. The live-key guard moved with
     * the credential — see `payment-keys.service.spec.ts`.
     */
    it('boots with no Stripe key at all', () => {
      expect(() => validateEnv(base)).not.toThrow();
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
});
