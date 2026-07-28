import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { RequestContextService } from '../../../common/context/request-context';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { DomainException } from '../../../common/errors/domain.exception';
import { ErrorCode } from '../../../common/errors/error-codes';
import type { AccessTokenClaims, AuthContext } from '../auth.types';
import { TokenService } from '../token.service';

type AuthedRequest = Request & { auth?: AuthContext };

/**
 * Global guard. Public routes pass through; every other route requires a valid
 * Bearer access token. Verification is stateless (no DB) — the token's claims
 * populate the request + request context (organizationId/userId) for tenant
 * scoping. Revocation is handled at refresh time via the auth_sessions row.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly context: RequestContextService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.isPublic(ctx)) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const claims = await this.authenticate(req.headers.authorization);
    req.auth = this.toAuthContext(claims);
    this.context.set({ organizationId: claims.org, userId: claims.sub });
    return true;
  }

  private isPublic(ctx: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        ctx.getHandler(),
        ctx.getClass(),
      ]) ?? false
    );
  }

  private async authenticate(header?: string): Promise<AccessTokenClaims> {
    const token = this.bearerToken(header);
    if (!token) throw this.unauthorized('Authentication required');
    const claims = await this.verify(token);
    if (claims.typ !== 'access') throw this.unauthorized('Invalid token type');
    return claims;
  }

  private async verify(token: string): Promise<AccessTokenClaims> {
    try {
      return await this.tokens.verifyAccess(token);
    } catch {
      throw this.unauthorized('Invalid or expired token');
    }
  }

  private toAuthContext(claims: AccessTokenClaims): AuthContext {
    return {
      userId: claims.sub,
      organizationId: claims.org,
      sessionId: claims.sid,
      persona: claims.persona,
    };
  }

  private bearerToken(header?: string): string | null {
    if (!header?.startsWith('Bearer ')) return null;
    return header.slice(7).trim() || null;
  }

  private unauthorized(message: string): DomainException {
    return new DomainException(
      ErrorCode.UNAUTHORIZED,
      message,
      HttpStatus.UNAUTHORIZED,
    );
  }
}
