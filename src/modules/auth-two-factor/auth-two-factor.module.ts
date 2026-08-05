import { Module } from '@nestjs/common';
import { SecretCipher } from '../../common/crypto/secret-cipher';
import { AuthModule } from '../auth/auth.module';
import { PlatformModule } from '../platform/platform.module';
import { UsersModule } from '../users/users.module';
import { AuthTwoFactorController } from './auth-two-factor.controller';
import { AuthTwoFactorRepository } from './auth-two-factor.repository';
import { AuthTwoFactorService } from './auth-two-factor.service';
import { TwoFactorSignInController } from './two-factor-signin.controller';
import { TwoFactorSignInService } from './two-factor-signin.service';

/**
 * Two-factor sign-in with an authenticator app + one-time recovery codes
 * (US-SET-03 / US-ACC-07). The TOTP seed is encrypted at rest (SecretCipher) —
 * it must be readable to verify a code — while recovery codes are only ever
 * compared, so just their hashes are stored. Also hosts the PUBLIC second step
 * of a 2FA sign-in (`POST /auth/two-factor`): it lives here rather than in
 * `auth` so the dependency points one way — this module imports AuthModule for
 * TokenService/startSession/throttle; auth never imports back. Emails the member on disable via the
 * outbox (PlatformModule); reads their identity through UsersModule's service.
 */
@Module({
  imports: [UsersModule, PlatformModule, AuthModule],
  controllers: [AuthTwoFactorController, TwoFactorSignInController],
  providers: [
    AuthTwoFactorService,
    AuthTwoFactorRepository,
    SecretCipher,
    TwoFactorSignInService,
  ],
  exports: [AuthTwoFactorService],
})
export class AuthTwoFactorModule {}
