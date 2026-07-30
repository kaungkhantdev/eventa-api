import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../../config/env.validation';
import type {
  AccessTokenClaims,
  Persona,
  RefreshTokenClaims,
} from './auth.types';

export interface TokenSubject {
  userId: string;
  organizationId: number;
  sessionId: string;
  persona: Persona;
}

/**
 * Signs and verifies the access + refresh JWTs (HS256 via the configured secret).
 * Access tokens are short-lived and verified statelessly; refresh tokens are
 * long-lived and additionally gated by a live auth_sessions row (revocable).
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  get accessTtlSeconds(): number {
    return this.config.get('JWT_ACCESS_TTL', { infer: true });
  }

  get refreshTtlSeconds(): number {
    return this.config.get('JWT_REFRESH_TTL', { infer: true });
  }

  signAccess(s: TokenSubject): Promise<string> {
    const claims: AccessTokenClaims = {
      sub: s.userId,
      org: s.organizationId,
      sid: s.sessionId,
      persona: s.persona,
      typ: 'access',
    };
    return this.jwt.signAsync(claims, { expiresIn: this.accessTtlSeconds });
  }

  signRefresh(s: TokenSubject): Promise<string> {
    const claims: RefreshTokenClaims = {
      sub: s.userId,
      org: s.organizationId,
      sid: s.sessionId,
      persona: s.persona,
      typ: 'refresh',
    };
    return this.jwt.signAsync(claims, { expiresIn: this.refreshTtlSeconds });
  }

  verifyAccess(token: string): Promise<AccessTokenClaims> {
    return this.jwt.verifyAsync<AccessTokenClaims>(token);
  }

  verifyRefresh(token: string): Promise<RefreshTokenClaims> {
    return this.jwt.verifyAsync<RefreshTokenClaims>(token);
  }
}
