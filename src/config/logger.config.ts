import type { ConfigService } from '@nestjs/config';
import type { Params } from 'nestjs-pino';
import type { Env } from './env.validation';

/**
 * pino (nestjs-pino) options. Every HTTP log line carries `correlationId`
 * (set by CorrelationIdMiddleware onto the request); secrets are redacted;
 * pretty output in dev, silent in tests, structured JSON in production.
 */
export function buildLoggerOptions(config: ConfigService<Env, true>): Params {
  const env = config.get('NODE_ENV', { infer: true });
  const isProd = env === 'production';
  const isTest = env === 'test';

  return {
    pinoHttp: {
      level: isTest ? 'silent' : config.get('LOG_LEVEL', { infer: true }),
      customProps: (req) => ({
        correlationId: (req as { correlationId?: string }).correlationId,
      }),
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
        ],
        remove: true,
      },
      transport:
        !isProd && !isTest
          ? {
              target: 'pino-pretty',
              options: { singleLine: true, translateTime: 'SYS:standard' },
            }
          : undefined,
    },
  };
}
