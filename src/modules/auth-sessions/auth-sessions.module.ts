import { Module } from '@nestjs/common';
import { AuthSessionsController } from './auth-sessions.controller';
import { AuthSessionsRepository } from './auth-sessions.repository';
import { AuthSessionsService } from './auth-sessions.service';

/**
 * "See and sign out my other devices" (US-ACC-09, surfaced by US-SET-04). Owns
 * only the caller's own auth_sessions rows; sign-in/sign-out themselves stay in
 * AuthModule.
 */
@Module({
  controllers: [AuthSessionsController],
  providers: [AuthSessionsService, AuthSessionsRepository],
  exports: [AuthSessionsService],
})
export class AuthSessionsModule {}
