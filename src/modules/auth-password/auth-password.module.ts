import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformModule } from '../platform/platform.module';
import { PasswordChangeService } from './auth-password-change.service';
import { AuthPasswordController } from './auth-password.controller';
import { PasswordRepository } from './auth-password.repository';
import { PasswordResetService } from './auth-password-reset.service';
import { PasswordService } from './auth-password.service';

/**
 * Password lifecycle: hashing (argon2), the forgotten-password reset link
 * (US-ACC-04) and change-while-signed-in (US-ACC-05). Both flows revoke sessions,
 * so they depend on AuthModule's TokenService/AuthRepository (`forwardRef` — auth
 * also verifies passwords on sign-in).
 *
 * PlatformModule supplies the `OutboxPort` both flows' mail rides: the reset
 * link, and the confirmation a change queues in the SAME transaction as the
 * password write (US-DISC-12 AC4), which is why the repository holds the port
 * rather than only the services.
 */
@Module({
  imports: [forwardRef(() => AuthModule), PlatformModule],
  controllers: [AuthPasswordController],
  providers: [
    PasswordService,
    PasswordRepository,
    PasswordResetService,
    PasswordChangeService,
  ],
  exports: [PasswordService, PasswordRepository],
})
export class AuthPasswordModule {}
