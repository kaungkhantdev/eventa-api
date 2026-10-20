import { randomUUID } from 'node:crypto';
import {
  type GoogleGrant,
  GoogleOAuthError,
  GoogleOAuthPort,
} from './ports/google-oauth.port';
import {
  CALENDAR_SCOPES,
  FAKE_ACCOUNT,
  FAKE_AUTH_CODE,
  FAKE_REFRESH_PREFIX,
} from '../../common/constants/calendar-connection.constants';

/**
 * A Google consent that needs no Google (US-MTG-08): its "consent screen" is
 * the callback itself, carrying a fixed code, so a local stack and the e2e
 * suite exercise the real state, PKCE and storage path end to end.
 *
 * Reachable only through `CALENDAR_PROVIDER=fake`, which the env schema
 * refuses in production — it would mark a workspace connected that no Google
 * account ever approved.
 */
export class FakeGoogleOAuthAdapter extends GoogleOAuthPort {
  readonly configured = true;

  constructor(private readonly redirectUri: string) {
    super();
  }

  authorizeUrl(state: string): string {
    return `${this.redirectUri}?code=${FAKE_AUTH_CODE}&state=${encodeURIComponent(state)}`;
  }

  exchangeCode(code: string, codeVerifier: string): Promise<GoogleGrant> {
    if (code !== FAKE_AUTH_CODE || codeVerifier === '') {
      return Promise.reject(new GoogleOAuthError(400, 'invalid_grant'));
    }
    return Promise.resolve({
      refreshToken: `${FAKE_REFRESH_PREFIX}${randomUUID()}`,
      accountEmail: FAKE_ACCOUNT,
      grantedScopes: [...CALENDAR_SCOPES],
    });
  }

  revoke(): Promise<void> {
    return Promise.resolve();
  }
}
