import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformModule } from '../platform/platform.module';
import { ProfileController } from './profile.controller';
import { ProfileRepository } from './profile.repository';
import { ProfileService } from './profile.service';
import { UsersRepository } from './users.repository';

/**
 * User records: the `users` table other contexts read through (UsersRepository),
 * plus the member's own profile page (US-SET-01) — name, contact, timezone,
 * language, photo, and an email change confirmed by a link sent to the new
 * address. Signs that link with AuthModule's TokenService (`forwardRef` — auth
 * reads users to sign anyone in).
 */
@Module({
  imports: [forwardRef(() => AuthModule), PlatformModule],
  controllers: [ProfileController],
  providers: [UsersRepository, ProfileRepository, ProfileService],
  exports: [UsersRepository, ProfileService],
})
export class UsersModule {}
