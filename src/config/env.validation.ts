import { z } from 'zod';

/**
 * Environment schema — the single source of truth for process config.
 * `validateEnv` runs at ConfigModule bootstrap; the app refuses to start on an invalid env.
 */
export const envSchema = z.object({
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
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900), // seconds (15m)
  JWT_REFRESH_TTL: z.coerce.number().int().positive().default(604800), // seconds (7d)

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

  // OpenAPI
  EMIT_OPENAPI: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

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
