import { Module } from '@nestjs/common';
import { SecretCipher } from '../../common/crypto/secret-cipher';
import { PlatformModule } from '../platform/platform.module';
import { UsersModule } from '../users/users.module';
import { AuthTwoFactorController } from './auth-two-factor.controller';
import { AuthTwoFactorRepository } from './auth-two-factor.repository';
import { AuthTwoFactorService } from './auth-two-factor.service';

/**
 * Two-factor sign-in with an authenticator app + one-time recovery codes
 * (US-SET-03 / US-ACC-07). The TOTP seed is encrypted at rest (SecretCipher) —
 * it must be readable to verify a code — while recovery codes are only ever
 * compared, so just their hashes are stored. Emails the member on disable via the
 * outbox (PlatformModule); reads their identity through UsersModule's service.
 */
@Module({
  imports: [UsersModule, PlatformModule],
  controllers: [AuthTwoFactorController],
  providers: [AuthTwoFactorService, AuthTwoFactorRepository, SecretCipher],
  exports: [AuthTwoFactorService],
})
export class AuthTwoFactorModule {}
