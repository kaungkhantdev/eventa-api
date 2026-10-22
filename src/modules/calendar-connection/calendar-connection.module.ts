import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SecretCipher } from '../../common/crypto/secret-cipher';
import type { Env } from '../../config/env.validation';
import { AccessModule } from '../access/access.module';
import { MeetingsModule } from '../meetings/meetings.module';
import { CalendarConnectFlowService } from './calendar-connect-flow.service';
import { CalendarConnectionController } from './calendar-connection.controller';
import { CalendarConnectionRepository } from './calendar-connection.repository';
import { CalendarConnectionService } from './calendar-connection.service';
import { CalendarOAuthCallbackController } from './calendar-oauth-callback.controller';
import {
  type CalendarProviderName,
  redirectUriOf,
  resolveCalendarProvider,
} from './calendar-provider';
import { FakeGoogleOAuthAdapter } from './fake-google-oauth.adapter';
import { GoogleOAuthAdapter } from './google-oauth.adapter';
import { OffGoogleOAuthAdapter } from './off-google-oauth.adapter';
import { GoogleOAuthPort } from './ports/google-oauth.port';

/** One factory per provider name; the env schema decides which may run. */
const ADAPTERS: Record<
  CalendarProviderName,
  (config: ConfigService<Env, true>) => GoogleOAuthPort
> = {
  off: () => new OffGoogleOAuthAdapter(),
  fake: (config) => new FakeGoogleOAuthAdapter(redirectUriOf(config)),
  google: (config) => new GoogleOAuthAdapter(config),
};

/**
 * The workspace Google Calendar connection (E12, US-MTG-08): the
 * `calendar_connections` row, Settings → Integrations' three routes, and the
 * public OAuth callback.
 *
 * Depends on `MeetingsService` (to re-send what was saved while disconnected
 * once a connect succeeds) and `AccessModule` (`PermissionsGuard`, and
 * `PermissionsService` to re-check the starter at the callback and to decide
 * who sees the account address). No `AuthModule`: the OAuth state is an
 * opaque nonce, not a JWT. No `forwardRef` — this is a leaf that nothing
 * imports, so it cannot close a cycle.
 *
 * `GoogleOAuthPort` is a factory, not `useClass`: the real adapter takes an
 * optional fetch so its spec needs no network, and which adapter runs is
 * decided by `resolveCalendarProvider` from the env.
 */
@Module({
  imports: [MeetingsModule, AccessModule],
  controllers: [CalendarConnectionController, CalendarOAuthCallbackController],
  providers: [
    CalendarConnectionService,
    CalendarConnectFlowService,
    CalendarConnectionRepository,
    SecretCipher,
    {
      provide: GoogleOAuthPort,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        ADAPTERS[
          resolveCalendarProvider({
            CALENDAR_PROVIDER: config.get('CALENDAR_PROVIDER', { infer: true }),
            GOOGLE_CALENDAR_CLIENT_ID: config.get('GOOGLE_CALENDAR_CLIENT_ID', {
              infer: true,
            }),
            GOOGLE_CALENDAR_CLIENT_SECRET: config.get(
              'GOOGLE_CALENDAR_CLIENT_SECRET',
              { infer: true },
            ),
          })
        ](config),
    },
  ],
})
export class CalendarConnectionModule {}
