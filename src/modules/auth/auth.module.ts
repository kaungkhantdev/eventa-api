import { Module, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { Env } from '../../config/env.validation';
import { AccessModule } from '../access/access.module';
import { AuthPasswordModule } from '../auth-password/auth-password.module';
import { AuthSignupModule } from '../auth-signup/auth-signup.module';
import { PlatformModule } from '../platform/platform.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { LoginThrottleService } from './login-throttle.service';
import { TokenService } from './token.service';

/**
 * Authentication: sign-in, JWT access/refresh tokens, sessions and sign-out.
 * Registers the app-wide JwtAuthGuard and exports TokenService as the interface
 * the sibling auth contexts sign links with.
 *
 * Three genuine cycles are wired with `forwardRef`: sign-in verifies a password
 * (auth-password) which in turn revokes sessions; an unconfirmed sign-in re-sends
 * the confirmation email (auth-signup) which signs its link with TokenService; and
 * sign-in resolves the caller's permissions (access) whose invites need TokenService.
 */
@Module({
  imports: [
    PlatformModule,
    PassportModule,
    UsersModule,
    forwardRef(() => AccessModule),
    forwardRef(() => AuthSignupModule),
    forwardRef(() => AuthPasswordModule),
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
    AuthRepository,
    LoginThrottleService,
    TokenService,
    JwtStrategy,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AuthRepository, TokenService],
})
export class AuthModule {}
