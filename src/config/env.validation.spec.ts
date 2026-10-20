import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const base = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    JWT_SECRET: 'a-sufficiently-long-test-secret',
    // Required now: card payment runs through Stripe and only Stripe, so the
    // app refuses to boot without the keys rather than discovering they are
    // missing at the till.
    //
    // The bucket is required for the same reason: there is one object storage
    // backend, so a nameless bucket is a boot failure, not a runtime surprise.
    S3_BUCKET: 'eventa-uploads',
    S3_REGION: 'ap-southeast-1',
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

  /**
   * There is ONE object storage backend: an S3 bucket. Locally that bucket is
   * MinIO, which speaks the same API and is reached by pointing `S3_ENDPOINT`
   * at it — a different address, not a different implementation.
   */
  describe('object storage (US-DISC-11)', () => {
    it('applies the upload defaults', () => {
      const env = validateEnv(base);
      expect(env.UPLOAD_MAX_BYTES).toBe(5_242_880);
      expect(env.UPLOAD_URL_TTL_SECONDS).toBe(300);
    });

    /**
     * The switch that used to select an in-process store is gone, and its
     * absence is the point. It handed the browser `http://localhost/object-
     * storage/…`, which nothing serves, so an env that merely forgot to say
     * `s3` booted happily and then failed at every upload — far from the cause.
     * A bucket the app cannot name is now a boot failure.
     */
    it('has no in-process backend to fall back to', () => {
      expect(validateEnv(base)).not.toHaveProperty('STORAGE_PROVIDER');
    });

    it('refuses to boot without a bucket', () => {
      expect(() => validateEnv({ ...base, S3_BUCKET: undefined })).toThrow(
        /S3_BUCKET/,
      );
    });

    it('refuses to boot without a region', () => {
      expect(() => validateEnv({ ...base, S3_REGION: undefined })).toThrow(
        /S3_REGION/,
      );
    });

    /** How local dev reaches MinIO instead of Amazon. */
    it('takes an S3-compatible endpoint', () => {
      const env = validateEnv({
        ...base,
        S3_ENDPOINT: 'http://localhost:9000',
      });
      expect(env.S3_ENDPOINT).toBe('http://localhost:9000');
    });

    it('trims a trailing slash off the public base so URLs never double up', () => {
      const env = validateEnv({
        ...base,
        S3_PUBLIC_BASE_URL: 'https://cdn.eventa.co.th/',
      });
      expect(env.S3_PUBLIC_BASE_URL).toBe('https://cdn.eventa.co.th');
    });
  });
  /**
   * The workspace Google Calendar (US-MTG-04/08). Every variable is optional:
   * a server with none of them boots, resolves to 'off', and says so on
   * Settings → Integrations instead of failing a meeting save.
   */
  describe('Google Calendar (US-MTG-04/08)', () => {
    const google = {
      GOOGLE_CALENDAR_CLIENT_ID: 'client-id.apps.googleusercontent.com',
      GOOGLE_CALENDAR_CLIENT_SECRET: 'client-secret',
    };

    it('boots with nothing configured', () => {
      const env = validateEnv(base);
      expect(env.CALENDAR_PROVIDER).toBeUndefined();
      expect(env.GOOGLE_CALENDAR_CLIENT_ID).toBeUndefined();
      expect(env.GOOGLE_CALENDAR_CLIENT_SECRET).toBeUndefined();
      expect(env.GOOGLE_CALENDAR_REDIRECT_URI).toBeUndefined();
    });

    it.each(['off', 'fake', 'google'])('accepts CALENDAR_PROVIDER=%s', (v) => {
      const env = validateEnv({ ...base, ...google, CALENDAR_PROVIDER: v });
      expect(env.CALENDAR_PROVIDER).toBe(v);
    });

    it('refuses an unknown provider', () => {
      expect(() =>
        validateEnv({ ...base, CALENDAR_PROVIDER: 'outlook' }),
      ).toThrow(/CALENDAR_PROVIDER/);
    });

    it('refuses google without the client id', () => {
      expect(() =>
        validateEnv({
          ...base,
          CALENDAR_PROVIDER: 'google',
          GOOGLE_CALENDAR_CLIENT_SECRET: 'client-secret',
        }),
      ).toThrow(/GOOGLE_CALENDAR_CLIENT_ID/);
    });

    it('refuses google without the client secret', () => {
      expect(() =>
        validateEnv({
          ...base,
          CALENDAR_PROVIDER: 'google',
          GOOGLE_CALENDAR_CLIENT_ID: 'client-id',
        }),
      ).toThrow(/GOOGLE_CALENDAR_CLIENT_SECRET/);
    });

    it('refuses an empty client id', () => {
      expect(() =>
        validateEnv({ ...base, GOOGLE_CALENDAR_CLIENT_ID: '' }),
      ).toThrow(/GOOGLE_CALENDAR_CLIENT_ID/);
    });

    it('refuses a redirect URI that is not a URL', () => {
      expect(() =>
        validateEnv({ ...base, GOOGLE_CALENDAR_REDIRECT_URI: 'not a url' }),
      ).toThrow(/GOOGLE_CALENDAR_REDIRECT_URI/);
    });

    it('sets no redirect default — the adapter derives it from PUBLIC_API_URL', () => {
      expect(
        validateEnv({ ...base, ...google }).GOOGLE_CALENDAR_REDIRECT_URI,
      ).toBeUndefined();
    });

    it('refuses the fake in production, saying why', () => {
      expect(() =>
        validateEnv({
          ...base,
          NODE_ENV: 'production',
          CALENDAR_PROVIDER: 'fake',
        }),
      ).toThrow(
        'CALENDAR_PROVIDER=fake cannot run in production — no invite would ever reach Google.',
      );
    });

    it('allows the fake outside production', () => {
      expect(() =>
        validateEnv({ ...base, NODE_ENV: 'test', CALENDAR_PROVIDER: 'fake' }),
      ).not.toThrow();
    });

    it('allows google in production when both client values are set', () => {
      expect(() =>
        validateEnv({
          ...base,
          ...google,
          NODE_ENV: 'production',
          CALENDAR_PROVIDER: 'google',
        }),
      ).not.toThrow();
    });
  });
});
