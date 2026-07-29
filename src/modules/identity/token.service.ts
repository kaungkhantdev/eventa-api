import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../../config/env.validation';
import type {
  AccessTokenClaims,
  InviteTokenClaims,
  Persona,
  RefreshTokenClaims,
} from './auth.types';

/** Workspace invites are valid for 7 days. */
const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface TokenSubject {
  userId: string;
  organizationId: number;
  sessionId: string;
  persona: Persona;
}

export interface InviteSubject {
  userId: string;
  organizationId: number;
  membershipId: number;
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

  signInvite(s: InviteSubject): Promise<string> {
    const claims: InviteTokenClaims = {
      sub: s.userId,
      org: s.organizationId,
      mid: s.membershipId,
      typ: 'invite',
    };
    return this.jwt.signAsync(claims, { expiresIn: INVITE_TTL_SECONDS });
  }

  verifyAccess(token: string): Promise<AccessTokenClaims> {
    return this.jwt.verifyAsync<AccessTokenClaims>(token);
  }

  verifyRefresh(token: string): Promise<RefreshTokenClaims> {
    return this.jwt.verifyAsync<RefreshTokenClaims>(token);
  }

  verifyInvite(token: string): Promise<InviteTokenClaims> {
    return this.jwt.verifyAsync<InviteTokenClaims>(token);
  }
}
