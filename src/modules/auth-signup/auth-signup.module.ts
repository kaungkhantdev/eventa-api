import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthPasswordModule } from '../auth-password/auth-password.module';
import { PlatformModule } from '../platform/platform.module';
import { AuthSignupController } from './auth-signup.controller';
import { SignupRepository } from './auth-signup.repository';
import { SignupService } from './auth-signup.service';
import { ResendThrottleService } from './resend-throttle.service';

/**
 * Organizer sign-up (US-ACC-01): create the workspace + owner and confirm the
 * email. Needs TokenService (AuthModule) to sign the confirmation link — and
 * AuthModule needs SignupService to re-send it on an unconfirmed sign-in, so the
 * pair is wired with `forwardRef`.
 */
@Module({
  imports: [forwardRef(() => AuthModule), AuthPasswordModule, PlatformModule],
  controllers: [AuthSignupController],
  providers: [SignupService, SignupRepository, ResendThrottleService],
  exports: [SignupService, SignupRepository],
})
export class AuthSignupModule {}
