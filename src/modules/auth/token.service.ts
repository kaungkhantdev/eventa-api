import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../../config/env.validation';
import type {
  AccessTokenClaims,
  BookingClaimClaims,
  EmailChangeClaims,
  EmailVerificationClaims,
  InviteTokenClaims,
  PasswordResetClaims,
  Persona,
  RefreshTokenClaims,
  TwoFactorChallengeClaims,
} from './auth.types';
import {
  BOOKING_CLAIM_TTL_SECONDS,
  BOOKING_CLAIM_TYPE,
  EMAIL_CHANGE_TTL_SECONDS,
  EMAIL_VERIFICATION_TTL_SECONDS,
  INVITE_TTL_SECONDS,
  PASSWORD_RESET_TTL_SECONDS,
  TWO_FACTOR_CHALLENGE_TTL_SECONDS,
} from '../../common/constants/auth.constants';

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

export interface BookingClaimSubject {
  orderId: string;
  /** The booking's buyer email — the only inbox the link is sent to. */
  email: string;
}

/** A signed claim link's token, and the moment it stops working. */
export interface SignedBookingClaim {
  token: string;
  expiresAt: Date;
}

/**
 * Signs and verifies the access + refresh JWTs (HS256 via the configured secret).
 * Access tokens are short-lived, refresh tokens long-lived; both are gated by a
 * live auth_sessions row (revocable) — the access token on every request, in
 * JwtStrategy.
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

  /**
   * Sign the link a booking's buyer opens to create their account (US-DISC-15).
   *
   * Returns the expiry with the token because the email has to say when the
   * link stops working, and the token's own `exp` is the authority on that —
   * a second clock reading here could disagree with it by a second.
   */
  async signBookingClaim(s: BookingClaimSubject): Promise<SignedBookingClaim> {
    const claims: Omit<BookingClaimClaims, 'exp'> = {
      sub: s.orderId,
      email: s.email,
      typ: BOOKING_CLAIM_TYPE,
    };
    const token = await this.jwt.signAsync(claims, {
      expiresIn: BOOKING_CLAIM_TTL_SECONDS,
    });
    const { exp } = this.jwt.decode<{ exp: number }>(token);
    return { token, expiresAt: new Date(exp * 1000) };
  }

  /**
   * The `typ` check is the point, as it is for the 2FA challenge: every token
   * here shares one HS256 secret, so without it an access token — which the
   * browser holds — or an invite or reset token would verify as a claim. The
   * address is required too: it is what the account is created for. So is an
   * expiry: this service never signs a claim without one, and how long a used
   * link must be remembered is read from it.
   */
  async verifyBookingClaim(token: string): Promise<BookingClaimClaims> {
    const claims = await this.jwt.verifyAsync<BookingClaimClaims>(token);
    if (
      claims.typ !== BOOKING_CLAIM_TYPE ||
      typeof claims.sub !== 'string' ||
      typeof claims.email !== 'string' ||
      typeof claims.exp !== 'number'
    ) {
      throw new Error('Not a booking claim token');
    }
    return claims;
  }
}
