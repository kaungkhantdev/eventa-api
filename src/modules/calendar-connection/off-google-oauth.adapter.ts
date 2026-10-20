import { type GoogleGrant, GoogleOAuthPort } from './ports/google-oauth.port';

const NOT_CONFIGURED = 'Google Calendar is not configured on this server.';

/**
 * No Google client on this server (US-MTG-08). `configured` is false, so the
 * services answer "not set up" and never reach these methods; they throw in
 * case something does.
 */
export class OffGoogleOAuthAdapter extends GoogleOAuthPort {
  readonly configured = false;

  authorizeUrl(): string {
    throw new Error(NOT_CONFIGURED);
  }

  exchangeCode(): Promise<GoogleGrant> {
    return Promise.reject(new Error(NOT_CONFIGURED));
  }

  revoke(): Promise<void> {
    return Promise.reject(new Error(NOT_CONFIGURED));
  }
}
