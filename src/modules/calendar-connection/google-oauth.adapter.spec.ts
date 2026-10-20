import { GoogleOAuthAdapter, type FetchLike } from './google-oauth.adapter';
import { GoogleOAuthError } from './ports/google-oauth.port';

const CLIENT_ID = 'client-123.apps.googleusercontent.com';
const CLIENT_SECRET = 'shh-client-secret';

const configOf = (values: Record<string, string | undefined>) =>
  ({
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      const value = values[key];
      if (value === undefined) throw new Error(`missing ${key}`);
      return value;
    },
  }) as never;

const baseConfig = {
  GOOGLE_CALENDAR_CLIENT_ID: CLIENT_ID,
  GOOGLE_CALENDAR_CLIENT_SECRET: CLIENT_SECRET,
  PUBLIC_API_URL: 'https://api.eventa.test',
};

/** A base64url JWT-shaped string whose payload is `claims`. */
const idTokenWith = (claims: object): string =>
  [
    Buffer.from('{"alg":"RS256"}').toString('base64url'),
    Buffer.from(JSON.stringify(claims)).toString('base64url'),
    'signature',
  ].join('.');

const answer = (status: number, body: unknown) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);

type FetchCall = Parameters<FetchLike>;

describe('GoogleOAuthAdapter (US-MTG-08)', () => {
  let fetchImpl: jest.MockedFunction<FetchLike>;
  let adapter: GoogleOAuthAdapter;

  beforeEach(() => {
    fetchImpl = jest.fn<ReturnType<FetchLike>, FetchCall>();
    adapter = new GoogleOAuthAdapter(configOf(baseConfig), fetchImpl);
  });

  const formOf = (call: FetchCall) =>
    Object.fromEntries(new URLSearchParams(call[1].body));

  it('is configured', () => {
    expect(adapter.configured).toBe(true);
  });

  describe('the consent URL', () => {
    const url = () => new URL(adapter.authorizeUrl('42.nonce', 'challenge'));

    it('goes to Google’s v2 authorization endpoint', () => {
      expect(`${url().origin}${url().pathname}`).toBe(
        'https://accounts.google.com/o/oauth2/v2/auth',
      );
    });

    it('asks for openid, email and calendar events only, offline, with consent', () => {
      const p = url().searchParams;
      expect(p.get('client_id')).toBe(CLIENT_ID);
      expect(p.get('response_type')).toBe('code');
      expect(p.get('scope')).toBe(
        'openid email https://www.googleapis.com/auth/calendar.events',
      );
      expect(p.get('access_type')).toBe('offline');
      expect(p.get('prompt')).toBe('consent');
      expect(p.get('state')).toBe('42.nonce');
    });

    it('carries the PKCE S256 challenge', () => {
      const p = url().searchParams;
      expect(p.get('code_challenge')).toBe('challenge');
      expect(p.get('code_challenge_method')).toBe('S256');
    });

    it('sends no login_hint and does not widen earlier grants', () => {
      const p = url().searchParams;
      expect(p.has('login_hint')).toBe(false);
      expect(p.has('include_granted_scopes')).toBe(false);
    });

    it('derives the redirect URI from PUBLIC_API_URL and the callback route', () => {
      expect(url().searchParams.get('redirect_uri')).toBe(
        'https://api.eventa.test/api/v1/public/calendar-connection/google/callback',
      );
    });

    it('uses an explicit redirect URI when one is configured', () => {
      const explicit = new GoogleOAuthAdapter(
        configOf({
          ...baseConfig,
          GOOGLE_CALENDAR_REDIRECT_URI: 'https://tunnel.example/cb',
        }),
        fetchImpl,
      );
      expect(
        new URL(explicit.authorizeUrl('s', 'c')).searchParams.get(
          'redirect_uri',
        ),
      ).toBe('https://tunnel.example/cb');
    });
  });

  describe('exchanging the code', () => {
    const granted = {
      access_token: 'ya29.access',
      refresh_token: '1//refresh',
      scope:
        'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar.events',
      id_token: idTokenWith({ email: 'events@acme.co.th', sub: '1' }),
    };

    it('posts the code, the verifier and the redirect URI to the token endpoint', async () => {
      fetchImpl.mockReturnValue(answer(200, granted));
      await adapter.exchangeCode('the-code', 'the-verifier');
      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe('https://oauth2.googleapis.com/token');
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe(
        'application/x-www-form-urlencoded',
      );
      expect(formOf(fetchImpl.mock.calls[0])).toEqual({
        code: 'the-code',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri:
          'https://api.eventa.test/api/v1/public/calendar-connection/google/callback',
        grant_type: 'authorization_code',
        code_verifier: 'the-verifier',
      });
    });

    it('bounds the call with a timeout signal', async () => {
      fetchImpl.mockReturnValue(answer(200, granted));
      await adapter.exchangeCode('the-code', 'the-verifier');
      expect(fetchImpl.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    });

    it('returns the refresh token, the account and the granted scopes', async () => {
      fetchImpl.mockReturnValue(answer(200, granted));
      await expect(
        adapter.exchangeCode('the-code', 'the-verifier'),
      ).resolves.toEqual({
        refreshToken: '1//refresh',
        accountEmail: 'events@acme.co.th',
        grantedScopes: [
          'openid',
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/calendar.events',
        ],
      });
    });

    it('reports a withheld refresh token and a missing email as null', async () => {
      fetchImpl.mockReturnValue(
        answer(200, {
          access_token: 'ya29.access',
          id_token: idTokenWith({ sub: '1' }),
        }),
      );
      await expect(
        adapter.exchangeCode('the-code', 'the-verifier'),
      ).resolves.toEqual({
        refreshToken: null,
        accountEmail: null,
        grantedScopes: [],
      });
    });

    it('reports no account when there is no id_token at all', async () => {
      fetchImpl.mockReturnValue(answer(200, { refresh_token: '1//r' }));
      const grant = await adapter.exchangeCode('the-code', 'the-verifier');
      expect(grant.accountEmail).toBeNull();
    });

    it('fails with the status and Google’s code, and nothing else', async () => {
      fetchImpl.mockReturnValue(
        answer(400, {
          error: 'invalid_grant',
          error_description: 'Bad code the-code for events@acme.co.th',
        }),
      );
      const failure = adapter.exchangeCode('the-code', 'the-verifier');
      await expect(failure).rejects.toBeInstanceOf(GoogleOAuthError);
      await expect(failure).rejects.toThrow(
        /^Google OAuth failed \(HTTP 400, invalid_grant\)$/,
      );
    });

    it('drops an error value that is not a plain OAuth code', async () => {
      fetchImpl.mockReturnValue(
        answer(401, { error: 'Invalid client <events@acme.co.th>' }),
      );
      const error = (await adapter
        .exchangeCode('the-code', 'the-verifier')
        .catch((e: unknown) => e)) as GoogleOAuthError;
      expect(error.message).toBe('Google OAuth failed (HTTP 401)');
      expect(error.message).not.toContain('acme');
    });

    it('fails with the status alone when the body is not JSON', async () => {
      fetchImpl.mockReturnValue(
        Promise.resolve({
          ok: false,
          status: 503,
          json: () => Promise.reject(new SyntaxError('Unexpected token <')),
        } as Response),
      );
      await expect(
        adapter.exchangeCode('the-code', 'the-verifier'),
      ).rejects.toThrow(/^Google OAuth failed \(HTTP 503\)$/);
    });
  });

  describe('revoking', () => {
    it('posts the token to the revoke endpoint, with a timeout', async () => {
      fetchImpl.mockReturnValue(answer(200, {}));
      await adapter.revoke('1//refresh');
      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe('https://oauth2.googleapis.com/revoke');
      expect(init.method).toBe('POST');
      expect(formOf(fetchImpl.mock.calls[0])).toEqual({ token: '1//refresh' });
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('fails with a GoogleOAuthError when Google refuses', async () => {
      fetchImpl.mockReturnValue(answer(400, { error: 'invalid_token' }));
      await expect(adapter.revoke('1//refresh')).rejects.toThrow(
        'Google OAuth failed (HTTP 400, invalid_token)',
      );
    });
  });
});
