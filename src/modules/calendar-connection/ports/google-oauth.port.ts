/**
 * What a completed Google consent hands back (US-MTG-08). Access tokens are
 * deliberately absent: this API never calls the Calendar itself, and an
 * access token it does not need is one it cannot leak.
 */
export interface GoogleGrant {
  /** Null when Google withheld it — the connect then fails, it cannot sync. */
  refreshToken: string | null;
  /** The `email` claim of the id_token: which account granted access. */
  accountEmail: string | null;
  /** What the Admin actually ticked, which may be less than was asked for. */
  grantedScopes: string[];
}

/** An OAuth `error` code is repeated only if it looks like one. */
const OAUTH_ERROR_CODE = /^[a-z_]{1,40}$/;

/**
 * Google refused a token-endpoint call.
 *
 * Carries the HTTP status and, at most, Google's machine `error` code — never
 * `error_description` and never the body, which can quote the code, the
 * client id or the account back. Enough to look the failure up, nothing a log
 * line should not hold.
 */
export class GoogleOAuthError extends Error {
  override readonly name = 'GoogleOAuthError';
  readonly code: string | null;

  constructor(
    readonly status: number,
    code?: unknown,
  ) {
    const safeCode =
      typeof code === 'string' && OAUTH_ERROR_CODE.test(code) ? code : null;
    super(
      `Google OAuth failed (HTTP ${status}${safeCode ? `, ${safeCode}` : ''})`,
    );
    this.code = safeCode;
  }
}

/**
 * The Google OAuth seam (US-MTG-08): build the consent URL, trade the code it
 * returns for a grant, and revoke a grant on disconnect.
 *
 * Bound by `CalendarConnectionModule` to the real adapter, the fake (local
 * runs and e2e, refused in production) or the off adapter, by
 * `resolveCalendarProvider`.
 */
export abstract class GoogleOAuthPort {
  /** False when this server has no Google client: Connect answers 409. */
  abstract readonly configured: boolean;

  /** Google's consent screen for this state and PKCE S256 challenge. */
  abstract authorizeUrl(state: string, codeChallenge: string): string;

  /** Trade the callback's code, proving the PKCE verifier. */
  abstract exchangeCode(
    code: string,
    codeVerifier: string,
  ): Promise<GoogleGrant>;

  /** Withdraw the grant at Google. Callers treat it as best-effort. */
  abstract revoke(refreshToken: string): Promise<void>;
}
