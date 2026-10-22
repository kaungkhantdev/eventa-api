import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation';
import { redirectUriOf } from './calendar-provider';
import {
  type GoogleGrant,
  GoogleOAuthError,
  GoogleOAuthPort,
} from './ports/google-oauth.port';
import {
  AUTHORIZE_URL,
  CALENDAR_SCOPES,
  FORM,
  REQUEST_TIMEOUT_MS,
  REVOKE_URL,
  TOKEN_URL,
} from '../../common/constants/calendar-connection.constants';

/**
 * Just enough of `fetch` to post one form and read one JSON body. Injected so
 * the spec needs no network (no test reaches Google).
 */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

/** The fields of Google's token response this adapter reads. */
interface TokenResponse {
  refresh_token?: unknown;
  scope?: unknown;
  id_token?: unknown;
}

/**
 * Google's OAuth 2.0 web-server flow with PKCE (US-MTG-08), over plain
 * `fetch` — three form posts do not justify an SDK, its retry policy and its
 * logging.
 *
 * Errors carry the HTTP status and Google's `error` code only (see
 * `GoogleOAuthError`); a response body never reaches a message or a log.
 *
 * UNPROVEN AGAINST A REAL ACCOUNT. Every test runs against a stubbed fetch, so
 * the requests are verified and Google's live behaviour (PKCE with a Web
 * client, the id_token claims) is not.
 */
export class GoogleOAuthAdapter extends GoogleOAuthPort {
  readonly configured: boolean;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;

  constructor(
    config: ConfigService<Env, true>,
    private readonly fetchImpl: FetchLike = globalThis.fetch,
  ) {
    super();
    this.clientId =
      config.get('GOOGLE_CALENDAR_CLIENT_ID', { infer: true }) ?? '';
    this.clientSecret =
      config.get('GOOGLE_CALENDAR_CLIENT_SECRET', { infer: true }) ?? '';
    this.redirectUri = redirectUriOf(config);
    this.configured = this.clientId !== '' && this.clientSecret !== '';
  }

  authorizeUrl(state: string, codeChallenge: string): string {
    const query = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: CALENDAR_SCOPES.join(' '),
      // A refresh token, so the worker can sync while nobody is signed in…
      access_type: 'offline',
      // …and Google only re-issues one on a fresh consent, so a reconnect
      // must ask again rather than silently reuse the old grant.
      prompt: 'consent',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
    });
    return `${AUTHORIZE_URL}?${query.toString()}`;
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<GoogleGrant> {
    const body = (await this.postForm(TOKEN_URL, {
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: this.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    })) as TokenResponse;
    return {
      refreshToken:
        typeof body.refresh_token === 'string' ? body.refresh_token : null,
      accountEmail: emailClaimOf(body.id_token),
      grantedScopes: (typeof body.scope === 'string' ? body.scope : '')
        .split(' ')
        .filter(Boolean),
    };
  }

  async revoke(refreshToken: string): Promise<void> {
    await this.postForm(REVOKE_URL, { token: refreshToken });
  }

  private async postForm(
    url: string,
    form: Record<string, string>,
  ): Promise<unknown> {
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: FORM,
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new GoogleOAuthError(response.status, errorCodeOf(body));
    }
    return body;
  }
}

/** Google's machine `error` field, if the body has one. Vetted by the error. */
function errorCodeOf(body: unknown): unknown {
  return typeof body === 'object' && body !== null && 'error' in body
    ? body.error
    : undefined;
}

/**
 * The `email` claim of the id_token. Its signature is not checked: it came
 * straight from Google's token endpoint over TLS, in answer to our own client
 * secret, which is the assurance a signature would otherwise provide.
 */
function emailClaimOf(idToken: unknown): string | null {
  if (typeof idToken !== 'string') return null;
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8'),
    );
    const email =
      typeof payload === 'object' && payload !== null && 'email' in payload
        ? payload.email
        : null;
    return typeof email === 'string' ? email : null;
  } catch {
    return null;
  }
}
