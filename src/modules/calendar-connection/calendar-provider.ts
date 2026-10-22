import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation';
import { CALENDAR_CALLBACK_PATH } from '../../common/constants/calendar-connection.constants';

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
