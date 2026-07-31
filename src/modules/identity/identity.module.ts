import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import type { Env } from '../../config/env.validation';
import { PlatformModule } from '../platform/platform.module';
import { AccessController } from './access/access.controller';
import { AccessRepository } from './access/access.repository';
import { AccessService } from './access/access.service';
import { MembersController } from './access/members.controller';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { IdentityRepository } from './identity.repository';
import { PasswordChangeService } from './password-change.service';
import { PasswordRepository } from './password.repository';
import { PasswordResetService } from './password-reset.service';
import { PasswordService } from './password.service';
import { PermissionsService } from './permissions.service';
import { SignupRepository } from './signup.repository';
import { SignupService } from './signup.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TokenService } from './token.service';

/**
 * Identity & Access bounded context: authentication (JWT access + refresh),
 * sessions, and (later) RBAC enforcement. Registers the app-wide auth guard and
 * exposes its repository + password service as the typed interface other modules
 * may depend on.
 */
@Module({
  imports: [
    PlatformModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
      }),
    }),
  ],
  controllers: [AuthController, AccessController, MembersController],
  providers: [
    AccessService,
    AccessRepository,
    AuthService,
    IdentityRepository,
    PasswordService,
    PermissionsService,
    PermissionsGuard,
    PasswordChangeService,
    PasswordResetService,
    PasswordRepository,
    SignupService,
    SignupRepository,
    TokenService,
    JwtStrategy,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [
    IdentityRepository,
    PasswordService,
    PermissionsService,
    PermissionsGuard,
  ],
})
export class IdentityModule {}
