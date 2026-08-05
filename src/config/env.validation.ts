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

    // Outbox relay (separate entrypoint)
    RABBITMQ_EXCHANGE: z.string().default('eventa.events'),
    OUTBOX_POLL_MS: z.coerce.number().int().positive().default(1000),
    OUTBOX_BATCH: z.coerce.number().int().positive().default(100),

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
    // the attendee enters it into the provider's own hosted fields, and we hold
    // only references. `stripe` talks to the real provider; `fake` is the
    // in-process double the test suite and local development run against.
    PAYMENT_PROVIDER: z.enum(['stripe', 'fake']).default('fake'),
    /** Platform secret key. Never logged, never returned — see the pino redact list. */
    STRIPE_SECRET_KEY: z.string().min(1).optional(),
    /** Shared secret the webhook signature is verified against. */
    STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
    /** How long a PromptPay QR stays scannable before the buyer must ask again. */
    PROMPTPAY_EXPIRY_SECONDS: z.coerce.number().int().positive().default(900), // 15m

    // OpenAPI
    EMIT_OPENAPI: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  })
  // Choosing the real provider without its keys would fail at the first charge,
  // in front of a buyer. Fail at boot instead.
  .refine(
    (env) =>
      env.PAYMENT_PROVIDER !== 'stripe' ||
      (!!env.STRIPE_SECRET_KEY && !!env.STRIPE_WEBHOOK_SECRET),
    {
      message:
        'PAYMENT_PROVIDER=stripe requires STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET',
      path: ['PAYMENT_PROVIDER'],
    },
  )
  // A live key outside production means a test run, a seed script or a local
  // experiment can charge a real card. Test-mode keys are the only ones that
  // belong anywhere but production.
  .refine(
    (env) =>
      env.NODE_ENV === 'production' ||
      !LIVE_STRIPE_KEY.test(env.STRIPE_SECRET_KEY ?? ''),
    {
      message:
        'A live Stripe key (sk_live_/rk_live_) is only allowed when NODE_ENV=production — use a test-mode key from the Stripe dashboard.',
      path: ['STRIPE_SECRET_KEY'],
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
