import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { Clock } from '../../common/time/clock';
import type {
  AuthContext,
  OrganizationRow,
  Persona,
  RefreshTokenClaims,
  UserRow,
} from './auth.types';
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

type LoginUser = { user: UserRow; org: OrganizationRow };

@Injectable()
export class AuthService {
  constructor(
    private readonly repo: IdentityRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly clock: Clock,
  ) {}

  async login(input: LoginInput): Promise<LoginResult> {
    const found = await this.authenticate(input);
    const sessionId = await this.openSession(found, input);
    await this.recordSignIn(found, input);
    const { accessToken, refreshToken } = await this.issueTokens(
      found,
      sessionId,
    );
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

  async refresh(
    refreshToken: string,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const claims = await this.verifyRefreshToken(refreshToken);
    await this.assertSessionLive(claims.sid);
    const accessToken = await this.tokens.signAccess({
      userId: claims.sub,
      organizationId: claims.org,
      sessionId: claims.sid,
      persona: claims.persona,
    });
    return { accessToken, expiresIn: this.tokens.accessTtlSeconds };
  }

  async me(auth: AuthContext): Promise<MeResponseDto> {
    const profile = await this.loadProfile(auth.userId);
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

  // ── login steps ──────────────────────────────────────────────────────────

  private async authenticate(input: LoginInput): Promise<LoginUser> {
    const found = await this.repo.findLoginUser(
      input.orgSlug,
      input.email,
      input.persona ?? 'admin',
    );
    if (!found?.user.passwordHash) return this.rejectInvalid(found, input);
    const ok = await this.passwords.verify(
      found.user.passwordHash,
      input.password,
    );
    if (!ok) return this.rejectInvalid(found, input);
    this.assertActive(found.user);
    return found;
  }

  private openSession(found: LoginUser, input: LoginInput): Promise<string> {
    const expiresAt = new Date(
      this.clock.now().getTime() + this.tokens.refreshTtlSeconds * 1000,
    );
    return this.repo.createSession({
      organizationId: found.org.id,
      userId: found.user.id,
      device: input.device,
      ip: input.ip,
      expiresAt,
    });
  }

  private async recordSignIn(
    found: LoginUser,
    input: LoginInput,
  ): Promise<void> {
    await this.repo.touchLastActive(found.user.id);
    await this.repo.recordAudit({
      organizationId: found.org.id,
      type: 'signin',
      title: `Signed in from ${input.device}`,
      actorUserId: found.user.id,
      ip: input.ip,
    });
  }

  private async issueTokens(
    found: LoginUser,
    sessionId: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
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
    return { accessToken, refreshToken };
  }

  // ── refresh / me steps ───────────────────────────────────────────────────

  private async verifyRefreshToken(token: string): Promise<RefreshTokenClaims> {
    let claims: RefreshTokenClaims;
    try {
      claims = await this.tokens.verifyRefresh(token);
    } catch {
      throw this.invalidToken();
    }
    if (claims.typ !== 'refresh') throw this.invalidToken();
    return claims;
  }

  private async assertSessionLive(sessionId: string): Promise<void> {
    const session = await this.repo.findValidSession(sessionId);
    if (!session) {
      throw new DomainException(
        ErrorCode.UNAUTHORIZED,
        'Session expired or revoked',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  private async loadProfile(userId: string): Promise<LoginUser> {
    const profile = await this.repo.findProfile(userId);
    if (!profile) {
      throw new DomainException(
        ErrorCode.UNAUTHORIZED,
        'User no longer exists',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return profile;
  }

  // ── failures ─────────────────────────────────────────────────────────────

  private async rejectInvalid(
    found: LoginUser | null,
    input: LoginInput,
  ): Promise<never> {
    if (found) await this.auditFail(found, input);
    throw this.invalidCredentials();
  }

  private assertActive(user: UserRow): void {
    if (user.status !== 'Active') {
      throw new DomainException(
        ErrorCode.FORBIDDEN,
        'Account is not active',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private auditFail(found: LoginUser, input: LoginInput): Promise<void> {
    return this.repo.recordAudit({
      organizationId: found.org.id,
      type: 'fail',
      title: `Failed sign-in for ${input.email}`,
      actorUserId: found.user.id,
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
