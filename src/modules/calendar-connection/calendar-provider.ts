import type { ConfigService } from '@nestjs/config';
import { Permission } from '../../common/decorators/require-permissions.decorator';
import type { Env } from '../../config/env.validation';

/** Which Google OAuth implementation this server runs (US-MTG-08). */
export type CalendarProviderName = 'off' | 'fake' | 'google';

type CalendarEnv = Partial<
  Pick<
    Env,
    | 'CALENDAR_PROVIDER'
    | 'GOOGLE_CALENDAR_CLIENT_ID'
    | 'GOOGLE_CALENDAR_CLIENT_SECRET'
  >
>;

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

/**
 * The provider in effect. An explicit `CALENDAR_PROVIDER` wins; otherwise a
 * server that holds both client values is taken to mean Google, and anything
 * less is 'off' — which shows as "not set up" rather than failing a connect
 * half-way through Google's consent screen.
 */
export function resolveCalendarProvider(
  env: CalendarEnv,
): CalendarProviderName {
  if (env.CALENDAR_PROVIDER) return env.CALENDAR_PROVIDER;
  return env.GOOGLE_CALENDAR_CLIENT_ID && env.GOOGLE_CALENDAR_CLIENT_SECRET
    ? 'google'
    : 'off';
}

/**
 * The redirect URI Google must call back: an explicit
 * `GOOGLE_CALENDAR_REDIRECT_URI`, else this service's public address plus
 * `CALENDAR_CALLBACK_PATH`. The same value goes into the consent URL and the
 * code exchange — Google refuses the exchange if the two differ.
 */
export function redirectUriOf(config: ConfigService<Env, true>): string {
  return (
    config.get('GOOGLE_CALENDAR_REDIRECT_URI', { infer: true }) ??
    `${config.getOrThrow('PUBLIC_API_URL', { infer: true })}${CALENDAR_CALLBACK_PATH}`
  );
}
