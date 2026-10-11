import type { ConfigService } from '@nestjs/config';
import type { Params } from 'nestjs-pino';
import { stdSerializers } from 'pino';
import type { Env } from './env.validation';

/**
 * Query parameters whose VALUES may be written to the access log.
 *
 * An allowlist, not a denylist. `autoLogging` is on by default, and the
 * standard serializer fills `url` from `req.originalUrl` — query string and
 * all — so every request's parameters were logged. Most are harmless, but the
 * attendee directory searches by name and by email (the merge-prompt copy
 * tells organizers to "search the directory for the address"), so the one
 * parameter that mattered most was somebody's personal data.
 *
 * Safe-by-default is the right direction for a privacy rule: a masked
 * `page=3` costs one line here to restore, and an address already written to
 * a log cannot be unlogged. Add a parameter when you have decided it carries
 * no personal data — not merely because it would be convenient to see.
 */
const LOGGABLE_QUERY_VALUES: ReadonlySet<string> = new Set([
  'page',
  'limit',
  'sort',
  'order',
  'status',
  'segment',
  'tag',
  'from',
  'to',
  'format',
]);

/** Stands in for a value, so the parameter's presence still shows. */
const MASKED = '[redacted]';

/**
 * The request, with query values masked unless they are on the allowlist.
 *
 * The path and the parameter NAMES survive, because those are what an access
 * log is read for — which route, filtered or not, paged or not. The values are
 * the caller's data and belong in neither `url` nor `query`.
 */
function safeRequest(req: unknown): ReturnType<typeof stdSerializers.req> {
  const serialized = stdSerializers.req(
    req as Parameters<typeof stdSerializers.req>[0],
  );
  return Object.assign(serialized, {
    url: maskUrl(serialized.url),
    query: maskQuery(serialized.query as unknown),
    headers: maskReferer(serialized.headers),
  });
}

/**
 * The Referer names the page that made the call — and carries its whole URL.
 *
 * Masking `url` alone was half a fix. Whether the other half shows depends on
 * deployment: a browser's default `strict-origin-when-cross-origin` sends
 * only the origin to a DIFFERENT origin, so a console on app.eventa calling
 * an API on api.eventa leaks nothing. Serve both from one origin — which
 * `VITE_API_URL` leaves entirely open — and the same policy sends the full
 * URL, query and all, on every request. The same search would be back in the
 * log under a different field.
 *
 * The path survives, because which page called is worth knowing; only the
 * query is masked, by the same rule as the request's own URL.
 */
function maskReferer(
  headers: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!headers) return headers;
  const masked = { ...headers };
  // Both spellings: the HTTP header is the historical misspelling, but a
  // proxy or a test client may use the other.
  for (const name of ['referer', 'referrer']) {
    const value = masked[name];
    if (typeof value === 'string') masked[name] = maskUrl(value);
  }
  return masked;
}

function maskUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  const [path, search] = url.split('?');
  if (!search) return path;
  const masked = search
    .split('&')
    .map((pair) => {
      const name = pair.split('=')[0];
      return LOGGABLE_QUERY_VALUES.has(name) ? pair : `${name}=${MASKED}`;
    })
    .join('&');
  return `${path}?${masked}`;
}

function maskQuery(query: unknown): unknown {
  if (typeof query !== 'object' || query === null) return query;
  return Object.fromEntries(
    Object.entries(query as Record<string, unknown>).map(([name, value]) => [
      name,
      LOGGABLE_QUERY_VALUES.has(name) ? value : MASKED,
    ]),
  );
}

/**
 * pino (nestjs-pino) options. Every HTTP log line carries `correlationId`
 * (set by CorrelationIdMiddleware onto the request); secrets are redacted,
 * query values are masked unless allowlisted; pretty output in dev, silent in
 * tests, structured JSON in production.
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
      serializers: { req: safeRequest },
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
