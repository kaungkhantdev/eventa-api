import { z } from 'zod';

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

    // How long before a confirmation link can be asked for again. Long enough
    // that a slow mail server is not mistaken for a lost message, short enough
    // that somebody who really did lose one is not stuck waiting.
    VERIFY_RESEND_COOLDOWN_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(60),

    // Public web app base URL — used to build shareable/public event links.
    PUBLIC_WEB_URL: z
      .string()
      .url()
      .default('http://localhost:5173')
      .transform((v) => v.replace(/\/+$/, '')),

    // Where THIS service is reachable from the internet. Shown to organizers so
    // they can register their workspace's webhook endpoint in Stripe, so it has
    // to be the address Stripe can actually reach — a tunnel in dev, the real
    // host in deployment. Not derivable from a request: a callback arrives at
    // whatever proxy sits in front, and guessing from Host is how you end up
    // telling somebody to register a URL that only resolves inside the cluster.
    PUBLIC_API_URL: z
      .string()
      .url()
      .default('http://localhost:3000')
      .transform((v) => v.replace(/\/+$/, '')),

    // Observability
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    // Payments (US-DISC-05). PCI SAQ-A: no card data ever reaches this service.
    //
    // There is deliberately NO Stripe key here. Credentials are per workspace:
    // each organizer pastes their own on Settings → Payments, and the API
    // stores them encrypted (`payment_credentials`). A platform key would be a
    // fallback that silently took one workspace's money into another's account,
    // so its absence is the safety property.
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
