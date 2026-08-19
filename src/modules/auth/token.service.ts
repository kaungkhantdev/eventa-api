import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../../config/env.validation';
import type {
  AccessTokenClaims,
  EmailChangeClaims,
  EmailVerificationClaims,
  InviteTokenClaims,
  PasswordResetClaims,
  Persona,
  RefreshTokenClaims,
  TwoFactorChallengeClaims,
} from './auth.types';

/** Workspace invites are valid for 7 days. */
const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;
/** An email-confirmation link is valid for 24 hours. */
const EMAIL_VERIFICATION_TTL_SECONDS = 24 * 60 * 60;
/** An email-change confirmation link is valid for 24 hours. */
const EMAIL_CHANGE_TTL_SECONDS = 24 * 60 * 60;
/** A password-reset link is valid for 1 hour. */
const PASSWORD_RESET_TTL_SECONDS = 60 * 60;
/** The window between a correct password and its 2FA code (US-ACC-05). */
const TWO_FACTOR_CHALLENGE_TTL_SECONDS = 5 * 60;

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

export interface EmailVerificationSubject {
  userId: string;
  organizationId: number;
}

export interface PasswordResetSubject {
  userId: string;
  organizationId: number;
  passwordFingerprint: string;
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

  /** Session-length refresh window used when "remember me" is off (US-ACC-08). */
  get refreshTtlShortSeconds(): number {
    return this.config.get('JWT_REFRESH_TTL_SHORT', { infer: true });
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

  signRefresh(
    s: TokenSubject,
    ttlSeconds = this.refreshTtlSeconds,
  ): Promise<string> {
    const claims: RefreshTokenClaims = {
      sub: s.userId,
      org: s.organizationId,
      sid: s.sessionId,
      persona: s.persona,
      typ: 'refresh',
    };
    return this.jwt.signAsync(claims, { expiresIn: ttlSeconds });
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

  get twoFactorChallengeTtlSeconds(): number {
    return TWO_FACTOR_CHALLENGE_TTL_SECONDS;
  }

  signTwoFactorChallenge(s: {
    userId: string;
    organizationId: number;
    persona: Persona;
    rememberMe: boolean;
  }): Promise<string> {
    const claims: TwoFactorChallengeClaims = {
      sub: s.userId,
      org: s.organizationId,
      persona: s.persona,
      rem: s.rememberMe,
      typ: 'twofa',
    };
    return this.jwt.signAsync(claims, {
      expiresIn: TWO_FACTOR_CHALLENGE_TTL_SECONDS,
    });
  }

  /**
   * The `typ` check matters here: without it any other of our HS256 tokens (an
   * access token, an invite) would satisfy this verify and skip the code.
   */
  async verifyTwoFactorChallenge(
    token: string,
  ): Promise<TwoFactorChallengeClaims> {
    const claims = await this.jwt.verifyAsync<TwoFactorChallengeClaims>(token);
    if (claims.typ !== 'twofa') {
      throw new Error('Not a two-factor challenge token');
    }
    return claims;
  }

  signEmailVerification(s: EmailVerificationSubject): Promise<string> {
    const claims: EmailVerificationClaims = {
      sub: s.userId,
      org: s.organizationId,
      typ: 'verify_email',
    };
    return this.jwt.signAsync(claims, {
      expiresIn: EMAIL_VERIFICATION_TTL_SECONDS,
    });
  }

  verifyEmailVerification(token: string): Promise<EmailVerificationClaims> {
    return this.jwt.verifyAsync<EmailVerificationClaims>(token);
  }

  signEmailChange(s: {
    userId: string;
    organizationId: number;
    email: string;
  }): Promise<string> {
    const claims: EmailChangeClaims = {
      sub: s.userId,
      org: s.organizationId,
      email: s.email,
      typ: 'change_email',
    };
    return this.jwt.signAsync(claims, { expiresIn: EMAIL_CHANGE_TTL_SECONDS });
  }

  verifyEmailChange(token: string): Promise<EmailChangeClaims> {
    return this.jwt.verifyAsync<EmailChangeClaims>(token);
  }

  signPasswordReset(s: PasswordResetSubject): Promise<string> {
    const claims: PasswordResetClaims = {
      sub: s.userId,
      org: s.organizationId,
      pv: s.passwordFingerprint,
      typ: 'reset_password',
    };
    return this.jwt.signAsync(claims, {
      expiresIn: PASSWORD_RESET_TTL_SECONDS,
    });
  }

  verifyPasswordReset(token: string): Promise<PasswordResetClaims> {
    return this.jwt.verifyAsync<PasswordResetClaims>(token);
  }
}
