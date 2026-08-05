import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { AuthService, type LoginResult } from '../auth/auth.service';
import type { TwoFactorChallengeClaims } from '../auth/auth.types';
import { LoginThrottleService } from '../auth/login-throttle.service';
import { TokenService } from '../auth/token.service';
import { UsersRepository } from '../users/users.repository';
import { AuthTwoFactorService } from './auth-two-factor.service';

export interface CompleteTwoFactorInput {
  challengeToken: string;
  code: string;
  device: string;
  ip: string | null;
}

/** The throttle realm for code guessing — per account, not per address. */
const throttleId = (userId: string) => `twofa|${userId}`;

const EXPIRED_MESSAGE =
  'Your sign-in challenge expired — please sign in again.';
const BAD_CODE_MESSAGE =
  "That code didn't work. Try the next one, or a recovery code.";

/** 401 in this codebase is the plain constructor — there is no factory for it. */
function unauthorized(message: string): DomainException {
  return new DomainException(
    ErrorCode.UNAUTHORIZED,
    message,
    HttpStatus.UNAUTHORIZED,
  );
}

/**
 * The second step of a two-factor sign-in (US-ACC-05 / US-DISC-12): the
 * password already checked out and earned a short-lived challenge token; this
 * trades that token plus a valid authenticator (or recovery) code for the
 * session the password alone no longer buys.
 *
 * Code guessing is throttled per ACCOUNT with the same lockout the password
 * has — a six-digit code without a throttle is a keyspace, not a secret. The
 * account is re-checked against the claims: suspended between password and
 * code means no session, and a challenge is single-audience by construction.
 */
@Injectable()
export class TwoFactorSignInService {
  constructor(
    private readonly tokens: TokenService,
    private readonly throttle: LoginThrottleService,
    private readonly users: UsersRepository,
    private readonly twoFactor: AuthTwoFactorService,
    private readonly auth: AuthService,
  ) {}

  async complete(input: CompleteTwoFactorInput): Promise<LoginResult> {
    const claims = await this.verifyChallenge(input.challengeToken);
    await this.throttle.assertNotLocked(throttleId(claims.sub));
    const found = await this.requireAccount(claims);
    await this.assertCode(claims, input.code);
    return this.auth.startSession(found, {
      persona: claims.persona,
      rememberMe: claims.rem,
      device: input.device,
      ip: input.ip,
    });
  }

  private async verifyChallenge(
    token: string,
  ): Promise<TwoFactorChallengeClaims> {
    try {
      return await this.tokens.verifyTwoFactorChallenge(token);
    } catch {
      throw unauthorized(EXPIRED_MESSAGE);
    }
  }

  private async requireAccount(claims: TwoFactorChallengeClaims) {
    const found = await this.users.findProfile(claims.sub);
    if (
      !found ||
      found.user.organizationId !== claims.org ||
      found.user.persona !== claims.persona
    ) {
      throw unauthorized(EXPIRED_MESSAGE);
    }
    if (found.user.status !== 'Active') {
      throw DomainException.forbidden('This account cannot sign in.');
    }
    return found;
  }

  private async assertCode(
    claims: TwoFactorChallengeClaims,
    code: string,
  ): Promise<void> {
    const ok = await this.twoFactor.verify(claims.org, claims.sub, code);
    if (!ok) {
      await this.throttle.recordFailure(throttleId(claims.sub));
      throw unauthorized(BAD_CODE_MESSAGE);
    }
    await this.throttle.recordSuccess(throttleId(claims.sub));
  }
}
