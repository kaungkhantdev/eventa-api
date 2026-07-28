import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import type { AuthContext, Persona, RefreshTokenClaims } from './auth.types';
import { MeResponseDto, toMeResponse } from './dto/user-response.dto';
import { IdentityRepository } from './identity.repository';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

export interface LoginInput {
  email: string;
  password: string;
  orgSlug: string;
  persona?: Persona;
  device: string;
  ip: string | null;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: MeResponseDto;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly repo: IdentityRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  async login(input: LoginInput): Promise<LoginResult> {
    const found = await this.repo.findLoginUser(
      input.orgSlug,
      input.email,
      input.persona ?? 'admin',
    );

    // Uniform 401 for unknown user / no password / wrong password (no enumeration).
    if (!found || !found.user.passwordHash) {
      if (found) await this.auditFail(found.org.id, found.user.id, input);
      throw this.invalidCredentials();
    }

    const ok = await this.passwords.verify(
      found.user.passwordHash,
      input.password,
    );
    if (!ok) {
      await this.auditFail(found.org.id, found.user.id, input);
      throw this.invalidCredentials();
    }

    if (found.user.status !== 'Active') {
      throw new DomainException(
        ErrorCode.FORBIDDEN,
        'Account is not active',
        HttpStatus.FORBIDDEN,
      );
    }

    // Open a refresh session (revocable), then mint the token pair.
    const expiresAt = new Date(
      Date.now() + this.tokens.refreshTtlSeconds * 1000,
    );
    const sessionId = await this.repo.createSession({
      organizationId: found.org.id,
      userId: found.user.id,
      device: input.device,
      ip: input.ip,
      expiresAt,
    });
    await this.repo.touchLastActive(found.user.id);
    await this.repo.recordAudit({
      organizationId: found.org.id,
      type: 'signin',
      title: `Signed in from ${input.device}`,
      actorUserId: found.user.id,
      ip: input.ip,
    });

    const subject = {
      userId: found.user.id,
      organizationId: found.org.id,
      sessionId,
      persona: found.user.persona,
    };
    const [accessToken, refreshToken] = await Promise.all([
      this.tokens.signAccess(subject),
      this.tokens.signRefresh(subject),
    ]);
    const permissions = await this.repo.getPermissions(
      found.org.id,
      found.user.id,
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: this.tokens.accessTtlSeconds,
      user: toMeResponse(found.user, found.org, permissions),
    };
  }

  /** Exchange a valid refresh token for a fresh access token (session must be live). */
  async refresh(
    refreshToken: string,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    let claims: RefreshTokenClaims;
    try {
      claims = await this.tokens.verifyRefresh(refreshToken);
    } catch {
      throw this.invalidToken();
    }
    if (claims.typ !== 'refresh') throw this.invalidToken();

    const session = await this.repo.findValidSession(claims.sid);
    if (!session) {
      throw new DomainException(
        ErrorCode.UNAUTHORIZED,
        'Session expired or revoked',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const accessToken = await this.tokens.signAccess({
      userId: claims.sub,
      organizationId: claims.org,
      sessionId: claims.sid,
      persona: claims.persona,
    });
    return { accessToken, expiresIn: this.tokens.accessTtlSeconds };
  }

  async me(auth: AuthContext): Promise<MeResponseDto> {
    const profile = await this.repo.findProfile(auth.userId);
    if (!profile) {
      throw new DomainException(
        ErrorCode.UNAUTHORIZED,
        'User no longer exists',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const permissions = await this.repo.getPermissions(
      auth.organizationId,
      auth.userId,
    );
    return toMeResponse(profile.user, profile.org, permissions);
  }

  async logout(auth: AuthContext): Promise<void> {
    await this.repo.revokeSession(auth.sessionId);
    await this.repo.recordAudit({
      organizationId: auth.organizationId,
      type: 'revoke',
      title: 'Signed out',
      actorUserId: auth.userId,
      ip: null,
    });
  }

  private auditFail(
    organizationId: number,
    userId: string,
    input: LoginInput,
  ): Promise<void> {
    return this.repo.recordAudit({
      organizationId,
      type: 'fail',
      title: `Failed sign-in for ${input.email}`,
      actorUserId: userId,
      ip: input.ip,
    });
  }

  private invalidCredentials(): DomainException {
    return new DomainException(
      ErrorCode.UNAUTHORIZED,
      'Invalid email or password',
      HttpStatus.UNAUTHORIZED,
    );
  }

  private invalidToken(): DomainException {
    return new DomainException(
      ErrorCode.UNAUTHORIZED,
      'Invalid or expired token',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
