import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { type AuthContext, SESSION_TTL_MS } from './auth.types';
import { MeResponseDto, toMeResponse } from './dto/user-response.dto';
import { IdentityRepository } from './identity.repository';
import { PasswordService } from './password.service';

export interface LoginInput {
  email: string;
  password: string;
  orgSlug: string;
  persona?: 'admin' | 'attendee';
  device: string;
  ip: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly repo: IdentityRepository,
    private readonly passwords: PasswordService,
  ) {}

  async login(
    input: LoginInput,
  ): Promise<{ sessionId: string; user: MeResponseDto }> {
    const found = await this.repo.findLoginUser(
      input.orgSlug,
      input.email,
      input.persona ?? 'admin',
    );

    // Uniform 401 for unknown user / no password / wrong password (no enumeration).
    if (!found || !found.user.passwordHash) {
      if (found) {
        await this.repo.recordAudit({
          organizationId: found.org.id,
          type: 'fail',
          title: `Failed sign-in for ${input.email}`,
          actorUserId: found.user.id,
          ip: input.ip,
        });
      }
      throw this.invalidCredentials();
    }

    const ok = await this.passwords.verify(
      found.user.passwordHash,
      input.password,
    );
    if (!ok) {
      await this.repo.recordAudit({
        organizationId: found.org.id,
        type: 'fail',
        title: `Failed sign-in for ${input.email}`,
        actorUserId: found.user.id,
        ip: input.ip,
      });
      throw this.invalidCredentials();
    }

    if (found.user.status !== 'Active') {
      throw new DomainException(
        ErrorCode.FORBIDDEN,
        'Account is not active',
        HttpStatus.FORBIDDEN,
      );
    }

    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
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

    const permissions = await this.repo.getPermissions(
      found.org.id,
      found.user.id,
    );
    return {
      sessionId,
      user: toMeResponse(found.user, found.org, permissions),
    };
  }

  async me(auth: AuthContext): Promise<MeResponseDto> {
    const permissions = await this.repo.getPermissions(
      auth.org.id,
      auth.user.id,
    );
    return toMeResponse(auth.user, auth.org, permissions);
  }

  async logout(auth: AuthContext): Promise<void> {
    await this.repo.revokeSession(auth.sessionId);
    await this.repo.recordAudit({
      organizationId: auth.org.id,
      type: 'revoke',
      title: 'Signed out',
      actorUserId: auth.user.id,
      ip: null,
    });
  }

  private invalidCredentials(): DomainException {
    return new DomainException(
      ErrorCode.UNAUTHORIZED,
      'Invalid email or password',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
