import { z } from 'zod';

/** Stripe's live-mode secret and restricted keys — real money moves on these. */
const LIVE_STRIPE_KEY = /^(sk|rk)_live/;

/**
 * Environment schema — the single source of truth for process config.
 * `validateEnv` runs at ConfigModule bootstrap; the app refuses to start on an invalid env.
 */
export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3000),

    // Datastores
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    REDIS_URL: z.string().min(1).optional(),
    RABBITMQ_URL: z.string().min(1).optional(),

    // The exchange the outbox's routing keys are published to. This service
    // never publishes — eventa-relay does — but the name is part of the
    // contract, so it stays declared where the events are produced.
    RABBITMQ_EXCHANGE: z.string().default('eventa.events'),

    // Auth (JWT — access + refresh)
    JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
    /** base64 of exactly 32 random bytes — AES-256-GCM key for recoverable secrets. */
    SECRET_ENCRYPTION_KEY: z
      .string()
      .default('MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=')
      .refine(
        (v) => Buffer.from(v, 'base64').length === 32,
        'SECRET_ENCRYPTION_KEY must be base64 of 32 bytes',
      ),
    JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900), // seconds (15m)
    JWT_REFRESH_TTL: z.coerce.number().int().positive().default(604800), // seconds (7d)
    // "Remember me" off → a shorter, session-length refresh window (US-ACC-08).
    JWT_REFRESH_TTL_SHORT: z.coerce.number().int().positive().default(86400), // 1d

    // HTTP
    CORS_ORIGINS: z.string().default('*'),

    // Checkout: how long a seat/GA hold survives before it expires and releases
    // inventory (seconds). The attendee must complete checkout within this window.
    HOLD_TTL_SECONDS: z.coerce.number().int().positive().default(600), // 10m

    // Sign-in brute-force protection: after this many consecutive failures the
    // account is locked out for LOGIN_LOCK_SECONDS (a cool-off).
    LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    LOGIN_LOCK_SECONDS: z.coerce.number().int().positive().default(900), // 15m

    // Public web app base URL — used to build shareable/public event links.
    PUBLIC_WEB_URL: z
      .string()
      .url()
      .default('http://localhost:5173')
      .transform((v) => v.replace(/\/+$/, '')),

    // Observability
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    // Payments (US-DISC-05). PCI SAQ-A: no card data ever reaches this service —
    // Card payment runs through Stripe, and only Stripe. There is no in-process
    // stand-in: a double that can mint a "paid" order has no business in the
    // shipped app, so the suite supplies its own and this stays real.
    /** Platform secret key. Never logged, never returned — see the pino redact list. */
    STRIPE_SECRET_KEY: z.string().min(1),
    /** Shared secret the webhook signature is verified against. */
    STRIPE_WEBHOOK_SECRET: z.string().min(1),
    /** How long a PromptPay QR stays scannable before the buyer must ask again. */
    PROMPTPAY_EXPIRY_SECONDS: z.coerce.number().int().positive().default(900), // 15m

    // Object storage (US-DISC-11). Profile photos go straight from the browser
    // to the bucket via a presigned URL — the bytes never pass through the API.
    // `memory` is the in-process double for local dev and tests.
    STORAGE_PROVIDER: z.enum(['s3', 'memory']).default('memory'),
    S3_BUCKET: z.string().min(1).optional(),
    S3_REGION: z.string().min(1).optional(),
    /** Set for a S3-compatible endpoint (MinIO); enables path-style addressing. */
    S3_ENDPOINT: z.string().url().optional(),
    /** Omit BOTH in deployment so the default chain uses the instance's IAM role. */
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    /** CDN or bucket origin the photos are served from. */
    S3_PUBLIC_BASE_URL: z
      .string()
      .url()
      .optional()
      .transform((v) => v?.replace(/\/+$/, '')),
    UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(5_242_880), // 5 MiB
    UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300), // 5m

    // OpenAPI
    EMIT_OPENAPI: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  })
  // Choosing the real provider without its keys would fail at the first charge,
  // in front of a buyer. Fail at boot instead.
  // A live key outside production means a test run, a seed script or a local
  // experiment can charge a real card. Test-mode keys are the only ones that
  // belong anywhere but production.
  .refine(
    (env) =>
      env.NODE_ENV === 'production' ||
      !LIVE_STRIPE_KEY.test(env.STRIPE_SECRET_KEY),
    {
      message:
        'A live Stripe key (sk_live_/rk_live_) is only allowed when NODE_ENV=production — use a test-mode key from the Stripe dashboard.',
      path: ['STRIPE_SECRET_KEY'],
    },
  )
  // A bucket that is not named cannot be written to; find out at boot, not at
  // the first upload.
  .refine(
    (env) =>
      env.STORAGE_PROVIDER !== 's3' || (!!env.S3_BUCKET && !!env.S3_REGION),
    {
      message: 'STORAGE_PROVIDER=s3 requires S3_BUCKET and S3_REGION',
      path: ['STORAGE_PROVIDER'],
    },
  );

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return parsed.data;
}
