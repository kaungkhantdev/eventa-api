import { sql } from 'drizzle-orm';
import { Permission } from '../decorators/require-permissions.decorator';

/** The calendar-connection module's named constants. */

export const NOT_CONFIGURED =
  "Google Calendar isn't set up on this server yet.";

/** 32 random bytes as base64url: 43 characters, 256 bits. */
export const RANDOM_BYTES = 32;

/** How long a started connect may wait for Google's callback. */
export const STATE_TTL = sql`now() + interval '10 minutes'`;

export const NOW = sql`now()`;

/** Clearing the pending connect — on its first matching use, or a disconnect. */
export const NO_PENDING_STATE = {
  oauthStateHash: null,
  oauthStateUserId: null,
  oauthVerifierCipher: null,
  oauthStateExpiresAt: null,
} as const;

/** The 302 must not be cached, nor leak this URL's query onward. */
export const REDIRECT_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
};

/**
 * Write meeting events, and nothing else of the calendar: least privilege.
 * Reading the guest's free/busy or other calendars is not something any story
 * asks for, so the consent screen never offers it.
 */
export const CALENDAR_EVENTS_SCOPE =
  'https://www.googleapis.com/auth/calendar.events';

/** `openid email` only to learn WHICH account granted access, for the card. */
export const CALENDAR_SCOPES: readonly string[] = [
  'openid',
  'email',
  CALENDAR_EVENTS_SCOPE,
];

/**
 * Where Google sends the browser back, matching `setGlobalPrefix('api/v1')` in
 * `main.ts` and the route on `CalendarOAuthCallbackController`. Named once
 * here because the owner registers the full URI in Google Cloud by hand: if it
 * drifts from the mapped route, Google refuses the consent with
 * `redirect_uri_mismatch` and nothing on our side says why.
 */
export const CALENDAR_CALLBACK_PATH =
  '/api/v1/public/calendar-connection/google/callback';

/** Connecting and disconnecting is Manage integrations — Admin by default. */
export const MANAGE_INTEGRATIONS = Permission.setIntegrations;

/** The web route of Settings → Integrations. */
export const INTEGRATIONS_PATH = '/admin/settings-integrations';

/**
 * `<workspace id>.<43-character base64url nonce>` — the whole OAuth `state`;
 * why it is opaque is in `calendar-state.ts`.
 */
export const STATE_PATTERN = /^([1-9]\d{0,15})\.([A-Za-z0-9_-]{43})$/;

/** The only code this fake accepts — the one its consent URL hands out. */
export const FAKE_AUTH_CODE = 'fake-auth-code';

/** Prefix the worker's fake calendar recognises as a token it issued. */
export const FAKE_REFRESH_PREFIX = 'fake-refresh-';

export const FAKE_ACCOUNT = 'calendar@example.test';

export const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

export const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

/**
 * How long one call to Google may hold the request. The callback is a browser
 * waiting on a redirect and disconnect is an Admin waiting on a modal; ten
 * seconds is already long for either.
 */
export const REQUEST_TIMEOUT_MS = 10_000;

export const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };

export const OFF_PROVIDER_NOT_CONFIGURED =
  'Google Calendar is not configured on this server.';

/** An OAuth `error` code is repeated only if it looks like one. */
export const OAUTH_ERROR_CODE = /^[a-z_]{1,40}$/;
