import { Module, forwardRef } from '@nestjs/common';
import { AuthSignupModule } from '../auth-signup/auth-signup.module';
import { AuthModule } from '../auth/auth.module';
import { AuthSocialController } from './auth-social.controller';
import { AuthSocialRepository } from './auth-social.repository';
import { AuthSocialService } from './auth-social.service';
import { DevSocialVerifier } from './dev-social.verifier';
import { SocialVerifierPort } from './ports/social-verifier.port';

/**
 * Sign in with Google, Apple or LinkedIn (US-ACC-06). Verifies the provider's id
 * token and then reuses AuthService.startSession, so a social session is exactly
 * the same object a password sign-in produces. Creating a brand-new organizer
 * reuses the sign-up workspace bootstrap (AuthSignupModule).
 *
 * SocialVerifierPort is bound to a dev verifier; production must bind a real
 * JWKS-checking adapter — swapping the useClass changes nothing for callers.
 */
@Module({
  imports: [forwardRef(() => AuthModule), AuthSignupModule],
  controllers: [AuthSocialController],
  providers: [
    AuthSocialService,
    AuthSocialRepository,
    { provide: SocialVerifierPort, useClass: DevSocialVerifier },
  ],
  exports: [AuthSocialService],
})
export class AuthSocialModule {}
