import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionAuthGuard } from './guards/session-auth.guard';
import { IdentityRepository } from './identity.repository';
import { PasswordService } from './password.service';

/**
 * Identity & Access bounded context: authentication, sessions, and (later) RBAC
 * enforcement. Registers the app-wide session guard. Exposes its repository +
 * password service as the typed interface other modules may depend on.
 */
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    IdentityRepository,
    PasswordService,
    { provide: APP_GUARD, useClass: SessionAuthGuard },
  ],
  exports: [IdentityRepository, PasswordService],
})
export class IdentityModule {}
