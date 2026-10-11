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

type ReqSerializer = (req: unknown) => {
  url?: string;
  query?: unknown;
  headers?: Record<string, unknown>;
};

function serializeReq(
  url: string,
  query: Record<string, string>,
  headers: Record<string, string> = {},
) {
  const serializers = options().serializers as { req: ReqSerializer };
  return serializers.req({
    method: 'GET',
    url,
    originalUrl: url,
    query,
    headers: { host: 'api.test', ...headers },
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

  /**
   * The Referer carries the WHOLE page URL, so masking `url` alone was half a
   * fix — my own, a commit earlier.
   *
   * Which half shows depends on deployment. A browser's default policy
   * (`strict-origin-when-cross-origin`) sends only the origin to a different
   * origin, so a console on app.eventa and an API on api.eventa leak nothing
   * here. Serve both from one origin — which `VITE_API_URL` leaves entirely
   * open — and the same policy sends the full URL, query string included, on
   * every XHR. The access log would then hold `?q=<email>` again, by a
   * different field, for the same search.
   */
  describe('the Referer header', () => {
    it('masks the query of the page that made the call', () => {
      const line = serializeReq(
        '/api/v1/attendees',
        {},
        {
          referer: `https://app.eventa.test/admin/attendees?q=${EMAIL}`,
        },
      );

      expect(JSON.stringify(line)).not.toContain(EMAIL);
    });

    /** Which page called is worth keeping; what was typed into it is not. */
    it('keeps the page it came from', () => {
      const line = serializeReq(
        '/api/v1/attendees',
        {},
        {
          referer: `https://app.eventa.test/admin/attendees?q=${EMAIL}`,
        },
      );

      expect(JSON.stringify(line)).toContain('/admin/attendees');
    });

    it('handles the misspelling the standard baked in', () => {
      const line = serializeReq(
        '/api/v1/attendees',
        {},
        {
          referrer: `https://app.eventa.test/admin/attendees?q=${EMAIL}`,
        },
      );

      expect(JSON.stringify(line)).not.toContain(EMAIL);
    });

    it('leaves a Referer with no query alone', () => {
      const line = serializeReq(
        '/api/v1/attendees',
        {},
        {
          referer: 'https://app.eventa.test/admin/attendees',
        },
      );

      expect(line.headers?.referer).toBe(
        'https://app.eventa.test/admin/attendees',
      );
    });
  });
});
