import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import type { Env } from '../../config/env.validation';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { IdentityRepository } from './identity.repository';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

/**
 * Identity & Access bounded context: authentication (JWT access + refresh),
 * sessions, and (later) RBAC enforcement. Registers the app-wide auth guard and
 * exposes its repository + password service as the typed interface other modules
 * may depend on.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    IdentityRepository,
    PasswordService,
    TokenService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [IdentityRepository, PasswordService],
})
export class IdentityModule {}
