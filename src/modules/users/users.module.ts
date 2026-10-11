import { Module, forwardRef } from '@nestjs/common';
import { ResendThrottleService } from '../../common/throttle/resend-throttle.service';
import { AuthModule } from '../auth/auth.module';
import { PlatformModule } from '../platform/platform.module';
import { PhoneVerificationService } from './phone-verification.service';
import { ProfileController } from './profile.controller';
import { ProfileRepository } from './profile.repository';
import { ProfileService } from './profile.service';
import { UsersRepository } from './users.repository';

/**
 * User records: the `users` table other contexts read through (UsersRepository),
 * plus the member's own profile page (US-SET-01) — name, contact, timezone,
 * language, photo, an email change confirmed by a link sent to the new address,
 * and a phone change confirmed by a code texted to the new number (US-DISC-11
 * AC3). Signs that link with AuthModule's TokenService (`forwardRef` — auth
 * reads users to sign anyone in).
 *
 * `PhoneVerificationService` is a second service in this module rather than a
 * module of its own because it writes the same `users` row the profile does,
 * and a sibling would have to reach into ProfileRepository to do it.
 * `ResendThrottleService` is the shared cool-off from `common/throttle` — the
 * same one sign-up's confirmation email uses — listed as a provider the way
 * `SecretCipher` is, so no module edge is needed for it.
 */
@Module({
  imports: [forwardRef(() => AuthModule), PlatformModule],
  controllers: [ProfileController],
  providers: [
    UsersRepository,
    ProfileRepository,
    ProfileService,
    PhoneVerificationService,
    ResendThrottleService,
  ],
  exports: [UsersRepository, ProfileService],
})
export class UsersModule {}
