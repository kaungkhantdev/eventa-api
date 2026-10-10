import type { ConfigService } from '@nestjs/config';
import type { Env } from './env.validation';
import { buildLoggerOptions } from './logger.config';

/**
 * What an access log line may say about the request.
 *
 * `pinoHttp.autoLogging` defaults to on (pino-http@11/logger.js:63 reads
 * `opts.autoLogging !== false`, and this config does not set it), so EVERY
 * request is logged — and the standard serializer fills `url` from
 * `req.originalUrl`, which in Express carries the query string
 * (pino-std-serializers@7/lib/req.js:72), plus a separate `query` object.
 *
 * The attendee directory searches by name and by email — the merge-prompt copy
 * literally tells organizers to "search the directory for the address" — so
 * `GET /attendees?search=somchai@example.test` wrote that address into the
 * access log of every such request. `redact` covered the auth header and the
 * cookie, which are the secrets, and nothing covered the data.
 *
 * Values are kept only for parameters on a known-safe list. Safe-by-default is
 * the right direction for a privacy rule: a masked `page=3` costs an operator
 * one line of config to restore, and an address in a log cannot be unlogged.
 */
function options(): Record<string, unknown> {
  const config = {
    get: (key: string) => (key === 'NODE_ENV' ? 'production' : 'info'),
  } as unknown as ConfigService<Env, true>;
  return buildLoggerOptions(config).pinoHttp as Record<string, unknown>;
}

type ReqSerializer = (req: unknown) => { url?: string; query?: unknown };

function serializeReq(url: string, query: Record<string, string>) {
  const serializers = options().serializers as { req: ReqSerializer };
  return serializers.req({
    method: 'GET',
    url,
    originalUrl: url,
    query,
    headers: { host: 'api.test' },
    socket: {},
  });
}

const EMAIL = 'somchai@example.test';

describe('the HTTP access log', () => {
  it('keeps the address a directory search was for out of the URL', () => {
    const line = serializeReq(`/api/v1/attendees?search=${EMAIL}`, {
      search: EMAIL,
    });

    expect(JSON.stringify(line)).not.toContain(EMAIL);
  });

  it('still says which route was called, and that it was filtered', () => {
    const line = serializeReq(`/api/v1/attendees?search=${EMAIL}`, {
      search: EMAIL,
    });

    expect(line.url).toContain('/api/v1/attendees');
    // The parameter's PRESENCE is operationally useful; its value is not.
    expect(line.url).toContain('search');
  });

  it('keeps the values of parameters that carry no personal data', () => {
    const line = serializeReq('/api/v1/attendees?page=3&limit=50&sort=name', {
      page: '3',
      limit: '50',
      sort: 'name',
    });

    expect(line.url).toContain('page=3');
    expect(line.url).toContain('limit=50');
    expect(line.url).toContain('sort=name');
  });

  it('masks a parameter nobody has classified yet', () => {
    const line = serializeReq('/api/v1/attendees?nickname=Somchai', {
      nickname: 'Somchai',
    });

    expect(JSON.stringify(line)).not.toContain('Somchai');
  });

  it('leaves a request with no query alone', () => {
    expect(serializeReq('/api/v1/health/ready', {}).url).toBe(
      '/api/v1/health/ready',
    );
  });

  it('still redacts the secrets it always did', () => {
    const redact = options().redact as { paths: string[] };

    expect(redact.paths).toContain('req.headers.authorization');
    expect(redact.paths).toContain('req.headers.cookie');
  });
});
